// Durable Zoho notification recovery: only unattempted, eligible order-confirmed
// outbox events. Runs through the EXACT production atomic-claim dispatcher.
// No arbitrary order IDs, no provider retries and no bulk historical backfill.
import { onRequestPost as dispatchOrderConfirmation } from './zoho-confirmation-dispatch.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'}
});
const MAX_SCAN=25;
const MAX_PER_TICK=3;
const MIN_AGE_MS=120000;
const MAX_AGE_MS=23*60*60*1000;

async function digest(value){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(String(value||''))));
}
async function isRecoveryService(request,env){
  const expected=String(env.ZOHO_ORDER_RECOVERY_TOKEN||'');
  if(expected.length<40)return false;
  const header=request.headers.get('authorization')||'';
  const provided=header.startsWith('Bearer ')?header.slice(7):'';
  const [left,right]=await Promise.all([digest(provided),digest(expected)]);
  let different=0;
  for(let i=0;i<left.length;i++)different|=left[i]^right[i];
  return provided.length>=40 && different===0;
}
function cutoffMs(env){
  const raw=String(env.ZOHO_ORDER_AUTOMATION_NOT_BEFORE||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw))return null;
  const value=Date.parse(raw);
  if(!Number.isFinite(value)||value>Date.now()+60000)return null;
  const canonical=raw.length===20
    ?new Date(value).toISOString().replace('.000Z','Z')
    :new Date(value).toISOString();
  return canonical===raw?value:null;
}
function dbConfig(env){
  const raw=String(env.SUPABASE_URL||'').trim().replace(/\/$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'').trim();
  if(!raw||!key)return null;
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||
      u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)return null;
    return {base:raw,key};
  }catch{return null;}
}
async function dbFetch(db,path,body){
  const response=await fetch(db.base+'/rest/v1/'+path,{
    method:body===undefined?'GET':'POST',cache:'no-store',
    headers:{apikey:db.key,Authorization:'Bearer '+db.key,
      Accept:'application/json','Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!response.ok)throw Error('DB_UNAVAILABLE');
  const data=await response.json();
  if(data===null)throw Error('DB_INVALID');
  return data;
}
export async function onRequestPost({request,env}){
  // Separate narrowly scoped secret; never accept operator or buyer bearer.
  if(!(await isRecoveryService(request,env)))return json({error:'Unauthorized'},401);
  let payload;
  try{payload=await request.json()}catch{return json({error:'Invalid JSON'},400);}
  const dryRun=payload && !Array.isArray(payload)&&typeof payload==='object'&&
    Object.keys(payload).length===1&&payload.dryRun===true;
  const recover=payload && !Array.isArray(payload)&&typeof payload==='object'&&
    Object.keys(payload).length===1&&payload.recover===true;
  if(!dryRun&&!recover)return json({error:'Invalid recovery request'},400);

  // Independent fail-closed global gates: no new sending permission.
  const cutoff=cutoffMs(env);
  const armed=env.ZOHO_ORDER_CONFIRMATION_MODE==='production'&&
    env.ZOHO_ORDER_GLOBAL_LAUNCH_APPROVED==='true'&&
    env.ZOHO_ORDER_GLOBAL_LAUNCH_ACK==='verified_customers_only_v1'&&
    env.ZOHO_ORDER_AUTOMATION_ENABLED==='true'&&
    env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true'&&
    String(env.ZOHO_ORDER_EVENT_TOKEN||'').length>=40&&cutoff!==null;
  if(!armed)return json({armed:false,error:'Global order confirmation gates not ready',
    emailSent:false},423);
  const db=dbConfig(env);
  if(!db)return json({error:'Database unavailable',emailSent:false},503);
  try{
    // Existing global claim hard-stops at 30/hour and 150/rolling 24 hours.
    const quota=await dbFetch(db,'rpc/zoho_order_delivery_telemetry',{});
    if(!Number.isSafeInteger(quota?.attemptsLastHour)||
      !Number.isSafeInteger(quota?.attemptsLast24h)||
      !Number.isSafeInteger(quota?.hourlyAttemptCap)||
      !Number.isSafeInteger(quota?.rolling24hAttemptCap))
      throw Error('QUOTA_UNKNOWN');
    if(quota.attemptsLastHour>=quota.hourlyAttemptCap||
      quota.attemptsLast24h>=quota.rolling24hAttemptCap)
      return json({armed:true,quotaAvailable:false,emailSent:false,
        reviewRequired:true},429);
    const now=Date.now();
    const lowerBound=new Date(Math.max(cutoff,now-MAX_AGE_MS)).toISOString();
    const upperBound=new Date(now-MIN_AGE_MS).toISOString();
    // Only original zero-attempt durable events. NEVER resend any claimed,
    // sending, sent, blocked, provider-unknown, or older notifications.
    const params=new URLSearchParams({
      select:'order_id,created_at,status,attempt_count',
      event_type:'eq.order_confirmed',provider:'eq.zoho_mail',
      status:'in.(pending_review,ready)',attempt_count:'eq.0',
      sent_at:'is.null',provider_message_id:'is.null',
      created_at:'gte.'+lowerBound,created_at:'lte.'+upperBound,
      order:'created_at.asc',limit:String(MAX_SCAN)
    });
    const rows=await dbFetch(db,'zoho_order_email_outbox?'+params.toString());
    if(!Array.isArray(rows))throw Error('QUEUE_INVALID');
    let eligible=0,accepted=0,reviewRequired=0,skipped=0;
    for(const row of rows){
      const id=Number(row?.order_id);
      if(!Number.isSafeInteger(id)||id<=0||row.attempt_count!==0||
        !['pending_review','ready'].includes(row.status)){skipped++;continue;}
      // The service-role-only eligibility RPC independently verifies Auth
      // email, order, payment capture/COD, cancellation, and age.
      const check=await dbFetch(db,'rpc/preview_zoho_order_confirmation_eligibility',
        {p_order_id:id});
      if(check?.eligible!==true){skipped++;continue;}
      eligible++;
      if(dryRun||eligible>MAX_PER_TICK)continue;
      // Reuse the EXACT current production dispatcher. Its fresh-order cutoff,
      // OAuth readiness and atomic DB claim are mandatory before Zoho sending.
      // Race/replays cannot submit a second provider attempt.
      const call=new Request('https://seller.fashionfussion.in/api/outreach/zoho-confirmation-dispatch',{
        method:'POST',headers:{Authorization:'Bearer '+env.ZOHO_ORDER_EVENT_TOKEN,
          'Content-Type':'application/json'},
        body:JSON.stringify({orderId:id,confirmSend:true})
      });
      const response=await dispatchOrderConfirmation({request:call,env});
      const result=await response.json().catch(()=>null);
      if(response.ok&&result?.accepted===true&&result?.sent===1)accepted++;
      else if(response.status!==409&&response.status!==423)reviewRequired++;
    }
    return json({armed:true,dryRun,candidatesScanned:rows.length,
      eligibleUnattempted:eligible,sentAccepted:accepted,skipped,
      reviewRequired,remainingBeyondBatch:eligible>MAX_PER_TICK,
      note:'No attempted/uncertain notification is ever automatically retried. Zoho acceptance is not inbox delivery.'});
  }catch{
    return json({error:'Recovery check unavailable',emailSent:false,
      reviewRequired:true},503);
  }
}
export function onRequestGet(){return json({error:'Method not allowed'},405);}

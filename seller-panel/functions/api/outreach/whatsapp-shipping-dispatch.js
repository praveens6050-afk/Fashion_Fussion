// PRIVATE customer shipping milestone dispatcher. DEFAULT NO SEND.
// Isolated from order-confirmed sending and Zoho Mail. Shipping requires
// dedicated launch token+flags, fresh post-consent event, and a DB atomic claim.
// Outbox (order_id,event_type) uniqueness + shared first-attempt rate caps
// suppress duplicates. Unknown provider outcomes are never retried.
import {verifyMetaOrderTemplate} from './whatsapp-meta-readiness.js';

const MAX_PER_TICK=2;
const EVENTS=Object.freeze({
  shipped:'Shipped',
  out_for_delivery:'Out for Delivery',
  delivered:'Delivered'
});
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'
}});
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value||''))));
}
async function matchBearer(request,expected,minLen) {
  if(typeof expected!=='string'||expected.length<minLen)return false;
  const hdr=request.headers.get('authorization')||'';
  const supplied=hdr.startsWith('Bearer ')?hdr.slice(7):'';
  if(supplied.length<minLen)return false;
  const [a,b]=await Promise.all([digest(supplied),digest(expected)]);
  let mismatch=0;
  for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
  return mismatch===0;
}
function parseCutoff(raw) {
  const s=String(raw||'').trim();
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s))return null;
  const timestamp=Date.parse(s);
  if(!Number.isFinite(timestamp)||timestamp>Date.now()
    ||timestamp<Date.parse('2026-10-01T00:00:00Z'))return null;
  const normal=new Date(timestamp).toISOString();
  return (s.length===20?normal.replace('.000Z','Z'):normal)===s?s:null;
}
function armed(env) {
  return env.WHATSAPP_SHIPPING_SENDING_ENABLED==='true'
    && env.WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED==='true'
    && env.WHATSAPP_SHIPPING_GLOBAL_LAUNCH_ACK==='verified_shipping_opt_in_v1'
    && /^[0-9]{13,25}$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID||''))
    && /^v\d+\.\d+$/.test(String(env.WHATSAPP_GRAPH_VERSION||''))
    && String(env.WHATSAPP_ACCESS_TOKEN||'').length>=20
    && String(env.WHATSAPP_ALLOWED_TEMPLATES||'').split(',').some(x=>x.trim()==='order_status_update')
    && parseCutoff(env.WHATSAPP_SHIPPING_NOT_BEFORE)!==null;
}
function database(env) {
  const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return null;
  return {base,key};
}
async function dbCall(db,path,body) {
  const result=await fetch(db.base+'/rest/v1/'+path,{
    method:body===undefined?'GET':'POST',cache:'no-store',
    headers:{apikey:db.key,Authorization:'Bearer '+db.key,
      Accept:'application/json','content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!result.ok)throw Error('DB_UNAVAILABLE');
  return result.json();
}
async function recheckConsent(db,claim,orderId) {
  const phone=encodeURIComponent(claim.recipientPhone);
  const order=await dbCall(db,'whatsapp_order_consents?order_id=eq.'+orderId
    +'&phone_e164=eq.'+phone+'&revoked_at=is.null&consented_at=not.is.null&select=order_id&limit=1');
  const global=await dbCall(db,'whatsapp_contact_consents?phone_e164=eq.'+phone
    +'&purpose=eq.transactional&status=eq.opted_in&revoked_at=is.null'
    +'&consented_at=not.is.null&select=phone_e164&limit=1');
  return Array.isArray(order)&&order.length===1&&Array.isArray(global)&&global.length===1;
}
function textValue(v,max) {
  return String(v||'').replace(/[\r\n\t]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
async function sendMeta(env,claim,label) {
  const name=textValue(claim.customerName,70);
  const order=textValue(claim.displayOrderId,80);
  if(!name||!order||!/^\+[1-9]\d{7,14}$/.test(String(claim.recipientPhone||'')))
    return {id:null,code:'INVALID_CLAIM'};
  const body={messaging_product:'whatsapp',recipient_type:'individual',
    to:claim.recipientPhone.slice(1),type:'template',
    template:{name:'order_status_update',language:{code:'en'},
      components:[{type:'body',parameters:[
        {type:'text',text:name},{type:'text',text:order},{type:'text',text:label}
      ]}]}};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try {
    const response=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION
      +'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/messages',{
      method:'POST',signal:controller.signal,redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,
        'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>null);
    const id=String(data?.messages?.[0]?.id||'');
    if(response.ok&&/^wamid\.[^\s]+$/.test(id)&&id.length<=255)
      return {id,code:null};
    return {id:null,code:response.ok?'PROVIDER_OUTCOME_UNKNOWN':'META_REJECTED'};
  }catch{
    return {id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};
  }finally{clearTimeout(timeout)}
}
export async function onRequestPost({request,env}) {
  let input;
  try{input=await request.json()}catch{return respond({error:'Invalid JSON'},400)}
  const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input):[];
  const preview=keys.length===1&&input.dryRun===true;
  const dispatch=keys.length===1&&input.dispatch===true;
  if(!preview&&!dispatch)return respond({error:'Only dryRun:true or dispatch:true accepted'},400);
  const valid=dispatch
    ?await matchBearer(request,env.WHATSAPP_SHIPPING_INTERNAL_TOKEN,40)
    :await matchBearer(request,env.OUTREACH_API_TOKEN,1);
  if(!valid)return respond({error:'Unauthorized'},401);
  if(dispatch&&!armed(env))
    return respond({armed:false,error:'Shipping dispatch not authorized',sent:0},423);
  const db=database(env);
  if(!db)return respond({error:'Database unavailable',sent:0},503);
  try {
    const since=Math.max(Date.parse(parseCutoff(env.WHATSAPP_SHIPPING_NOT_BEFORE)
      ||'2026-10-01T00:00:00Z'),Date.now()-23*60*60*1000);
    const params=new URLSearchParams({
      select:'id,order_id,event_type,created_at',
      event_type:'in.(shipped,out_for_delivery,delivered)',
      status:'in.(pending_review,ready)',attempt_count:'eq.0',
      attempt_started_at:'is.null',provider_message_id:'is.null',
      order:'created_at.asc',limit:'20'
    });
    params.append('created_at','gte.'+new Date(since).toISOString());
    params.append('created_at','lte.'+new Date().toISOString());
    const rows=await dbCall(db,'whatsapp_order_notification_outbox?'+params);
    if(!Array.isArray(rows))throw Error('Invalid queue');
    if(preview)return respond({dryRun:true,armed:armed(env),sent:0,
      candidates:rows.length,requiresExplicitLaunch:true});
    if(!rows.length)return respond({armed:true,dryRun:false,claimed:0,
      providerAccepted:0,reviewRequired:0,skipped:0,autoRetry:false});
    const meta=await verifyMetaOrderTemplate(env);
    if(meta.ready!==true)return respond({armed:false,
      error:'Meta sender/template preflight not verified',
      claimed:0,providerAccepted:0,sent:0,autoRetry:false},423);
    let claimed=0,providerAccepted=0,reviewRequired=0,skipped=0;
    for(const row of rows) {
      if(claimed>=MAX_PER_TICK)break;
      const orderId=Number(row.order_id),label=EVENTS[row.event_type];
      if(!Number.isSafeInteger(orderId)||orderId<=0||!label){skipped++;continue}
      const claim=await dbCall(db,'rpc/claim_whatsapp_shipping_event',{
        p_order_id:orderId,p_event_type:row.event_type,
        p_activation_cutoff:parseCutoff(env.WHATSAPP_SHIPPING_NOT_BEFORE)
      });
      if(!claim||!Number.isSafeInteger(Number(claim.outboxId))){skipped++;continue}
      claimed++;
      let result={id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};
      try {
        if(claim.statusLabel!==label)result={id:null,code:'INVALID_CLAIM'};
        else if(!(await recheckConsent(db,claim,orderId)))
          result={id:null,code:'CONSENT_REVOKED'};
        else result=await sendMeta(env,claim,label);
      }catch{result={id:null,code:'PROVIDER_OUTCOME_UNKNOWN'}}
      try {
        const finished=await dbCall(db,'rpc/finish_whatsapp_order_confirmation',{
          p_outbox_id:claim.outboxId,p_provider_message_id:result.id,
          p_error_code:result.code
        });
        if(finished!==true)reviewRequired++;
      }catch{reviewRequired++}
      if(result.id)providerAccepted++;
      if(result.code)reviewRequired++;
    }
    return respond({armed:true,dryRun:false,claimed,providerAccepted,
      reviewRequired,skipped,autoRetry:false,
      note:'Provider acceptance does not confirm delivery'});
  }catch{
    return respond({error:'WhatsApp shipping dispatch unavailable',
      sent:0,reviewRequired:true},503);
  }
}
export function onRequestGet(){return respond({error:'Method not allowed'},405)}

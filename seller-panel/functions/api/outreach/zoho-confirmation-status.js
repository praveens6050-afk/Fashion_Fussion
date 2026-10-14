// Read-only, bearer-protected status of the order-confirmation pipeline.
// This endpoint never approves, claims, sends, retries or exposes buyer PII.
function respond(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
async function digest(v){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v||'')))}
async function auth(req,env){
 if(!env.OUTREACH_API_TOKEN)return false;
 const h=req.headers.get('authorization')||'';
 const [a,b]=await Promise.all([digest(h.startsWith('Bearer ')?h.slice(7):''),digest(env.OUTREACH_API_TOKEN)]);
 let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;
}
export async function onRequestGet({request,env}){
 if(!(await auth(request,env)))return respond({error:'Unauthorized'},401);
 const url=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'');
 if(!url||!key)return respond({error:'Database not configured'},503);
 try{
  const q='event_type=eq.order_confirmed&select=id,status,created_at,attempt_count&order=created_at.desc&limit=100';
  const res=await fetch(url+'/rest/v1/zoho_order_email_outbox?'+q,{cache:'no-store',headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
  if(!res.ok)return respond({error:'Queue lookup unavailable'},503);
  const data=await res.json();
  if(!Array.isArray(data))return respond({error:'Invalid queue data'},503);
  const counts={pending_review:0,ready:0,sending:0,sent:0,blocked:0,failed:0};
  for(const row of data){if(Object.prototype.hasOwnProperty.call(counts,row.status))counts[row.status]++;}
  return respond({provider:'zoho_mail',sender:'orders@fashionfussion.in',
   sendingEnabled:env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true',
   automaticDispatcherEnabled:false,
   dispatchMode:String(env.ZOHO_ORDER_CONFIRMATION_MODE||'pilot'),
   sellerAutomationSwitchEnabled:env.ZOHO_ORDER_AUTOMATION_ENABLED==='true',
   customerEventAutomationRequiresSeparateFlag:true,
   sellerAutoModeArmed:env.ZOHO_ORDER_CONFIRMATION_MODE==='automatic' &&
      env.ZOHO_ORDER_AUTOMATION_ENABLED==='true' &&
      env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true',
   activationCutoffConfigured:Boolean(env.ZOHO_ORDER_AUTOMATION_NOT_BEFORE),
   scheduledQueueRecoveryEnabled:false,reviewRequired:true,
   sampleSize:data.length,counts,limitedToMostRecent:100});
 }catch{return respond({error:'Queue lookup unavailable'},503);}
}

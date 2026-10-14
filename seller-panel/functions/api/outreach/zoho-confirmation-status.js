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
// Match the dispatcher's fail-closed UTC parser without returning the timestamp
// or any private Cloudflare secret to the browser.
function validCutoff(value,now=Date.now()){
 const raw=String(value||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw))return false;
 const parsed=Date.parse(raw);
 if(!Number.isFinite(parsed)||parsed>now+60000)return false;
 const canonical=raw.length===20
   ? new Date(parsed).toISOString().replace('.000Z','Z')
   : new Date(parsed).toISOString();
 return canonical===raw;
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
  const mode=String(env.ZOHO_ORDER_CONFIRMATION_MODE||'pilot');
  const sendingEnabled=env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true';
  const automationSwitchEnabled=env.ZOHO_ORDER_AUTOMATION_ENABLED==='true';
  const cutoffConfigured=Boolean(String(env.ZOHO_ORDER_AUTOMATION_NOT_BEFORE||'').trim());
  const cutoffValid=validCutoff(env.ZOHO_ORDER_AUTOMATION_NOT_BEFORE);
  const testBuyerValue=String(env.ZOHO_ORDER_AUTOMATION_TEST_BUYER_EMAIL||'').trim().toLowerCase();
  const testBuyerConfigured=testBuyerValue.length<=254 &&
    /^\S+@\S+\.\S+$/.test(testBuyerValue);
  // Only a boolean leaves this endpoint: no buyer address or secret value.
  const globalApproval=env.ZOHO_ORDER_GLOBAL_LAUNCH_APPROVED==='true' &&
    env.ZOHO_ORDER_GLOBAL_LAUNCH_ACK==='verified_customers_only_v1';
  const autoModeArmed=(mode==='automatic'&&testBuyerConfigured||
      mode==='production'&&globalApproval)&&automationSwitchEnabled&&
      sendingEnabled&&cutoffValid;
  return respond({provider:'zoho_mail',sender:'orders@fashionfussion.in',
   sendingEnabled,
   automaticDispatcherEnabled:false,
   dispatchMode:mode,
   sellerAutomationSwitchEnabled:automationSwitchEnabled,
   customerEventAutomationRequiresSeparateFlag:true,
   sellerAutoModeArmed:autoModeArmed,
   activationCutoffConfigured:cutoffConfigured,
   activationCutoffValid:cutoffValid,
   testBuyerRestricted:mode!=='production',
   testBuyerConfigured,
   globalLaunchApproved:globalApproval,
   globalClaimRateCapped:true,
   productionReadyForSupervisedActivation:mode==='production' && cutoffValid &&
     globalApproval && !automationSwitchEnabled && !sendingEnabled,
   // This is a readiness report only. No permission to send is derived from
   // the presence of flags, and no Cloudflare bindings are changed here.
   sellerConfigurationReadyForControlledRollout:
      ['automatic','production'].includes(mode)&&cutoffValid&&
      (mode==='production'||testBuyerConfigured)&&
      !automationSwitchEnabled&&!sendingEnabled,
   scheduledQueueRecoveryEnabled:false,reviewRequired:true,
   sampleSize:data.length,counts,limitedToMostRecent:100});
 }catch{return respond({error:'Queue lookup unavailable'},503);}
}

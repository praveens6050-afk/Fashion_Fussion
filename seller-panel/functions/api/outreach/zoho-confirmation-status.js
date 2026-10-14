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
  // Read comprehensive aggregate counters from the service-only DB RPC.
  // Never return a row, order ID, address, token, or mailbox credential.
  const res=await fetch(url+'/rest/v1/rpc/zoho_order_delivery_telemetry',{
    method:'POST',cache:'no-store',
    headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',
      'Content-Type':'application/json'},
    body:'{}'
  });
  if(!res.ok)return respond({error:'Aggregate queue monitoring unavailable'},503);
  const data=await res.json();
  if(!data||typeof data!=='object'||Array.isArray(data))return respond({error:'Invalid queue telemetry'},503);
  const fields=['pendingReview','ready','sending','sent','blocked','stalePending10m',
    'stuckSending5m','attemptsLastHour','attemptsLast24h','hourlyAttemptCap',
    'rolling24hAttemptCap'];
  if(fields.some(k=>!Number.isSafeInteger(data[k])||data[k]<0))
    return respond({error:'Invalid queue telemetry'},503);
  const counts={pending_review:data.pendingReview,ready:data.ready,
    sending:data.sending,sent:data.sent,blocked:data.blocked,failed:0};
  const quotaAvailable=data.attemptsLastHour<data.hourlyAttemptCap &&
    data.attemptsLast24h<data.rolling24hAttemptCap;
  const backlogHealthy=data.stalePending10m===0&&data.stuckSending5m===0;
  const queueHealth=backlogHealthy ? 'healthy' : 'attention';
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
   // Aggregate data only; quota exhaustion stops the atomic global claim.
   queueHealth,quotaAvailable,
   attemptsLastHour:data.attemptsLastHour,attemptsLast24h:data.attemptsLast24h,
   hourlyAttemptCap:data.hourlyAttemptCap,
   rolling24hAttemptCap:data.rolling24hAttemptCap,
   stalePending10m:data.stalePending10m,stuckSending5m:data.stuckSending5m,
   productionReadyForSupervisedActivation:mode==='production' && cutoffValid &&
     globalApproval && quotaAvailable && backlogHealthy &&
     !automationSwitchEnabled && !sendingEnabled,
   // This is a readiness report only. No permission to send is derived from
   // the presence of flags, and no Cloudflare bindings are changed here.
   sellerConfigurationReadyForControlledRollout:
      ['automatic','production'].includes(mode)&&cutoffValid&&
      (mode==='production'||testBuyerConfigured)&&
      !automationSwitchEnabled&&!sendingEnabled,
   scheduledQueueRecoveryEnabled:false,reviewRequired:true,
   sampleSize:Object.values(counts).reduce((total,n)=>total+n,0),
   counts,limitedToMostRecent:false});
 }catch{return respond({error:'Queue lookup unavailable'},503);}
}

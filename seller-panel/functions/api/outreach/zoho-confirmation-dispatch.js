import { zohoSenderConfiguration } from './zoho-order-sender.js';
import { buildZohoOrderEmail } from './zoho-order-templates.js';

// Explicitly invoked internal order-confirmation transport. NO scheduler is registered.
// Disabled until a separate Cloudflare feature flag is explicitly enabled.
// Server-side Supabase RPCs atomically approve / claim / finalize one verified order.
// A claimed mail may be sent AT MOST ONCE; uncertain outcomes are blocked, never retried.
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'}
});
async function digest(value){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value||'')));
}
async function authorized(req,secret){
  if(!secret)return false;
  const h=req.headers.get('authorization')||'';
  const value=h.startsWith('Bearer ')?h.slice(7):'';
  const [a,b]=await Promise.all([digest(value),digest(secret)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
function dbConfig(env){
  const source=String(env.SUPABASE_URL||'').trim().replace(/\/$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'').trim();
  if(!source||!key)throw new Error('DB_CONFIG_MISSING');
  const u=new URL(source);
  if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||
     u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash){
    throw new Error('DB_CONFIG_INVALID');
  }
  return {source,key};
}
async function dbFetch(config,path,body){
  const headers={
    apikey:config.key,Authorization:'Bearer '+config.key,
    Accept:'application/json','Content-Type':'application/json'
  };
  const response=await fetch(config.source+path,{
    method:body===undefined?'GET':'POST',headers,cache:'no-store',
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!response.ok)throw new Error('DATABASE_UNAVAILABLE');
  const payload=await response.json().catch(()=>null);
  if(payload===null)throw new Error('DATABASE_BAD_RESPONSE');
  return payload;
}
async function rpc(config,name,body){
  // Do not use a user-provided RPC name/path.
  if(!['approve_zoho_order_confirmation','claim_zoho_order_confirmation',
       'finish_zoho_order_confirmation','preview_zoho_order_confirmation_eligibility'].includes(name))throw Error('RPC_UNSUPPORTED');
  return dbFetch(config,'/rest/v1/rpc/'+name,body);
}
async function zohoAccess(env){
  const cfg=zohoSenderConfiguration(env,'order_confirmation');
  if(cfg.missingConfiguration.length)throw new Error('ORDERS_MAIL_CONFIG_MISSING');
  const oauth=await fetch('https://accounts.zoho.in/oauth/v2/token',{
    method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
    body:new URLSearchParams({
      client_id:cfg.clientId,client_secret:cfg.clientSecret,
      refresh_token:cfg.refreshToken,grant_type:'refresh_token'
    }).toString()
  });
  const payload=await oauth.json().catch(()=>({}));
  if(!oauth.ok||typeof payload.access_token!=='string'||!payload.access_token)
    throw new Error('ORDERS_OAUTH_UNAVAILABLE');
  const headers={Authorization:'Zoho-oauthtoken '+payload.access_token,Accept:'application/json'};
  const accountRes=await fetch('https://mail.zoho.in/api/accounts',{
    method:'GET',headers,cache:'no-store'
  });
  const accountInfo=await accountRes.json().catch(()=>({}));
  if(!accountRes.ok||Number(accountInfo?.status?.code??200)!==200||
     !Array.isArray(accountInfo?.data))throw new Error('ORDERS_MAILBOX_UNAVAILABLE');
  const account=accountInfo.data.find(x=>String(x?.accountId||'')===cfg.accountId);
  const primary=String(account?.primaryEmailAddress||account?.mailboxAddress||'').trim().toLowerCase();
  const active=Array.isArray(account?.sendMailDetails)&&account.sendMailDetails.some(
    x=>x.status===true&&String(x.fromAddress||'').trim().toLowerCase()===cfg.fromAddress
  );
  if(!account||(primary!==cfg.fromAddress&&!active)||
     account.enabled===false||account.outgoingBlocked===true||
     account.mailboxStatus==='disabled')throw new Error('ORDERS_SENDER_UNAUTHORIZED');
  return {cfg,headers};
}
async function preview(env,orderId){
  const cfg=dbConfig(env);
  // No personal information returned to callers, only queue state and enablement.
  const rows=await dbFetch(cfg,
    '/rest/v1/zoho_order_email_outbox?order_id=eq.'+orderId+
    '&event_type=eq.order_confirmed&select=status,attempt_count,created_at&limit=1');
  if(!Array.isArray(rows))throw new Error('DATABASE_BAD_RESPONSE');
  const event=rows[0]||null;
  const eligibility=await rpc(cfg,'preview_zoho_order_confirmation_eligibility',{p_order_id:Number(orderId)});
  if(!eligibility||typeof eligibility!=='object'||Array.isArray(eligibility))
    throw new Error('INVALID_ELIGIBILITY_PREVIEW');
  return {
    dryRun:true,sent:0,eligibility,liveSendingEnabled:env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true',
    dispatchMode:String(env.ZOHO_ORDER_CONFIRMATION_MODE||'pilot'),
    automationEnabled:env.ZOHO_ORDER_AUTOMATION_ENABLED==='true',
    pilotAllowlisted:String(env.ZOHO_ORDER_CONFIRMATION_MODE||'pilot')==='pilot' &&
      String(env.ZOHO_ORDER_CONFIRMATION_TEST_ORDER_ID||'').trim()===String(orderId),
    autoSchedulerConfigured:false,
    eventStaged:Boolean(event),
    eventState:event?.status||null,
    attemptCount:event?.attempt_count||0,
    reviewRequired:!event||event.status==='pending_review',
    ordersConfigPresent:zohoSenderConfiguration(env,'order_confirmation').missingConfiguration.length===0,
    note:'No emails are sent in dry-run. Real sending additionally requires a verified eligible order and explicit server feature flag.'
  };
}
// The full production flow has a separate, explicit mode and an activation
// cutoff. Both order AND durable outbox event must be created after that UTC
// moment, so old/pilot rows cannot be backfilled automatically.
function activationCutoff(env){
  const value=String(env.ZOHO_ORDER_AUTOMATION_NOT_BEFORE||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const ms=Date.parse(value);
  if(!Number.isFinite(ms)||ms>Date.now()+60000) return null;
  const canonical=value.length===20
    ? new Date(ms).toISOString().replace('.000Z','Z')
    : new Date(ms).toISOString();
  if(canonical!==value)return null;
  return ms;
}
async function validateAutoWindow(env,orderId){
  const cutoff=activationCutoff(env);
  if(cutoff===null)return {allowed:false,reason:'AUTOMATION_CUTOFF_MISSING_OR_INVALID'};
  const db=dbConfig(env);
  const [orders,events]=await Promise.all([
    dbFetch(db,'/rest/v1/orders?id=eq.'+orderId+'&select=id,created_at&limit=1'),
    dbFetch(db,'/rest/v1/zoho_order_email_outbox?order_id=eq.'+orderId+
      '&event_type=eq.order_confirmed&provider=eq.zoho_mail'+
      '&select=created_at,status,attempt_count&limit=1')
  ]);
  if(!Array.isArray(orders)||!Array.isArray(events))throw Error('AUTO_WINDOW_DATA_BAD');
  const order=orders[0],event=events[0];
  const age=time=>typeof time==='string'?Date.parse(time):NaN;
  if(!order||!event||!Number.isFinite(age(order.created_at))||
     !Number.isFinite(age(event.created_at))||
     age(order.created_at)<cutoff||age(event.created_at)<cutoff||
     age(order.created_at)>Date.now()+300000||age(event.created_at)>Date.now()+300000){
    return {allowed:false,reason:'ORDER_BEFORE_AUTOMATION_CUTOFF_OR_MISSING'};
  }
  if(!['pending_review','ready'].includes(event.status)||event.attempt_count!==0){
    return {allowed:false,reason:'EVENT_ALREADY_PROCESSED_OR_NOT_READY'};
  }
  return {allowed:true};
}
async function dispatch(env,orderId){
  const db=dbConfig(env);
  // Provider readiness is checked BEFORE the atomic claim. Failure leaves queue untouched.
  const {cfg,headers}=await zohoAccess(env);
  // Service-only SQL validation; rejects stale/unpaid/unverified/cancelled orders.
  await rpc(db,'approve_zoho_order_confirmation',{p_order_id:orderId});
  const claims=await rpc(db,'claim_zoho_order_confirmation',{p_order_id:orderId});
  if(!Array.isArray(claims)||claims.length!==1)return {status:409,body:{
    accepted:false,sent:0,reason:'ORDER_NOT_ELIGIBLE_OR_ALREADY_PROCESSED'
  }};
  const row=claims[0];
  if(!Number.isSafeInteger(Number(row.outbox_id))||
    String(row.confirmed_order_id)!==String(orderId))return {status:500,body:{
      accepted:false,sent:0,reason:'CLAIM_RESULT_INVALID_CHECK_OUTBOX'
    }};
  const outboxId=row.outbox_id;
  let result='unknown',providerId=null;
  try {
    const mail=buildZohoOrderEmail({
      id:orderId,display_order_id:row.reference,customer_name:row.buyer_name,
      payment_method:row.payment_method
    },'order_confirmed');
    if(typeof row.buyer_email!=='string'||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.buyer_email)||
       mail.subject.length>180||mail.html.length>40000)
       throw new Error('INVALID_CLAIM_CONTENT');
    const response=await fetch('https://mail.zoho.in/api/accounts/'+
      encodeURIComponent(cfg.accountId)+'/messages',{
      method:'POST',cache:'no-store',
      headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({
        fromAddress:cfg.fromAddress,
        toAddress:row.buyer_email.trim(),
        subject:mail.subject,content:mail.html,mailFormat:'html',askReceipt:'no'
      })
    });
    const payload=await response.json().catch(()=>null);
    const providerStatus=payload?.status?.code;
    // Missing or malformed provider confirmation is UNKNOWN: never blindly retry.
    if(response.ok&&Number(providerStatus)===200){
      result='accepted';
      const identifier=payload?.data?.messageId??payload?.data?.mailId??null;
      providerId=identifier==null?null:String(identifier).slice(0,180);
    } else if(!response.ok&&providerStatus!=null){
      result='rejected';
    }
  }catch{
    result='unknown';
  }
  // Always finalize and block on uncertainty so no duplicate provider send is attempted.
  let finalized=false;
  try {
    finalized=await rpc(db,'finish_zoho_order_confirmation',{
      p_outbox_id:outboxId,p_outcome:result,p_provider_message_id:providerId
    })===true;
  }catch{
    finalized=false; // Sending may have happened; never encourage automatic retry.
  }
  if(!finalized)return {status:502,body:{
    accepted:false,sent:0,uncertainOutcome:true,
    reason:'FINALIZE_NOT_CONFIRMED_REVIEW_OUTBOX',retryAllowed:false
  }};
  if(result==='accepted')return {status:200,body:{
    accepted:true,sent:1,event:'order_confirmed',provider:'zoho_mail',
    deliveryConfirmed:false,retryAllowed:false
  }};
  return {status:502,body:{
    accepted:false,sent:0,uncertainOutcome:result==='unknown',
    reason:result==='unknown'?'PROVIDER_OUTCOME_UNKNOWN':'PROVIDER_NOT_ACCEPTED',
    retryAllowed:false
  }};
}
export async function onRequestPost({request,env}){
  // Two separate roles: operators can inspect; customer-side trusted backend may
  // request live delivery using its dedicated service token, never the public client.
  const [operator,orderService]=await Promise.all([
    authorized(request,env.OUTREACH_API_TOKEN),
    authorized(request,String(env.ZOHO_ORDER_EVENT_TOKEN||'').length>=40 ? env.ZOHO_ORDER_EVENT_TOKEN : null)
  ]);
  if(!operator&&!orderService)return json({error:'Unauthorized'},401);
  let body;
  try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request'},400);
  const id=String(body.orderId??'');
  if(!/^[1-9]\d{0,14}$/.test(id)||!Number.isSafeInteger(Number(id)))
    return json({error:'Invalid order ID'},400);
  if(body.dryRun===true&&Object.keys(body).sort().join(',')==='dryRun,orderId'){
    // Prevent a service-to-service bearer from probing customer order queue state.
    if(!operator)return json({error:'Operator authorization required for preview'},403);
    try{return json(await preview(env,id))}
    catch{return json({error:'Preview unavailable; no email sent'},503)}
  }
  // No live call, approval, claim or provider request unless explicitly enabled.
  if(env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED!=='true')
    return json({error:'Automatic order confirmation sending is disabled',sent:0},423);
  if(body.confirmSend!==true||Object.keys(body).sort().join(',')!=='confirmSend,orderId')
    return json({error:'Explicit send acknowledgement required'},400);
  // Strict modes: the existing default PILOT keeps a single-ID allowlist.
  // AUTOMATIC requires three separate opt-ins, service-only authentication,
  // and a fresh post-activation order plus staged outbox row.
  const mode=String(env.ZOHO_ORDER_CONFIRMATION_MODE||'pilot').trim();
  if(mode==='pilot'){
    const pilotId=String(env.ZOHO_ORDER_CONFIRMATION_TEST_ORDER_ID||'').trim();
    if(!/^[1-9]\d{0,14}$/.test(pilotId)||!Number.isSafeInteger(Number(pilotId))||pilotId!==id)
      return json({error:'Pilot order is not allowlisted',sent:0,reason:'PILOT_ORDER_NOT_ALLOWLISTED'},423);
  } else if(mode==='automatic'){
    if(!orderService)return json({error:'Automation requires internal service credentials',sent:0},403);
    if(env.ZOHO_ORDER_AUTOMATION_ENABLED!=='true')
      return json({error:'Order automation is disabled',sent:0,reason:'AUTOMATION_DISABLED'},423);
    let gate;
    try{gate=await validateAutoWindow(env,id)}
    catch{return json({error:'Automation window check unavailable',sent:0},503)}
    if(!gate.allowed)return json({error:'Order not allowed for automatic delivery',sent:0,reason:gate.reason},423);
  } else {
    return json({error:'Unknown order email dispatch mode',sent:0},423);
  }
  try {
    const r=await dispatch(env,id);
    return json(r.body,r.status);
  }catch{
    return json({accepted:false,sent:0,reason:
      'DISPATCH_PRECHECK_UNAVAILABLE',uncertainOutcome:false,retryAllowed:false},503);
  }
}

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
async function digest(v){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v||'')))}
async function equal(a,b){const[x,y]=await Promise.all([digest(a),digest(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0}
const ROUTES={
 'customer.care@fashionfussion.in':{prefix:'ZOHO_CRM_CUSTOMER_CARE',from:'customer.care@fashionfussion.in',department:'customer_support'},
 'seller.support@fashionfussion.in':{prefix:'ZOHO_CRM_SELLER_SUPPORT',from:'seller.support@fashionfussion.in',department:'seller_support'},
 'sales.team@fashionfussion.in':{prefix:'ZOHO_CRM_SALES_TEAM',from:'sales.team@fashionfussion.in',department:'sales'},
 'orders@fashionfussion.in':{prefix:'ZOHO_CRM_ORDERS',from:'orders@fashionfussion.in',department:'orders'}
};
async function rpc(base,key,name,body){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw new Error('Database dispatch state update failed');
 return r.json();
}
async function tokenFor(env,route,refresh){
 const prefix=route.prefix;
 const clientId=String(env[prefix+'_CLIENT_ID']||env.ZOHO_CLIENT_ID||''),clientSecret=String(env[prefix+'_CLIENT_SECRET']||env.ZOHO_CLIENT_SECRET||'');
 if(!clientId||!clientSecret||!refresh)throw new Error('Mailbox OAuth is not configured');
 const accountsUrl=new URL(String(env.ZOHO_ACCOUNTS_DOMAIN||'https://accounts.zoho.in'));
 if(accountsUrl.protocol!=='https:'||!/^accounts\.zoho\.(in|com|eu|com\.au|jp|ca|sa|uk)$/.test(accountsUrl.hostname))throw new Error('Zoho OAuth region configuration is invalid');
 const body=new URLSearchParams({refresh_token:refresh,client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token'});
 const r=await fetch(accountsUrl.origin+'/oauth/v2/token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body,redirect:'error'});
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data?.access_token)throw new Error('Mailbox OAuth refresh failed');
 return data.access_token;
}
export async function onRequestPost({request,env}){
 const secret=String(env.CRM_EMAIL_REPLY_INTERNAL_TOKEN||''),auth=request.headers.get('Authorization')||'',submitted=auth.startsWith('Bearer ')?auth.slice(7):'';
 if(secret.length<40||!submitted||!await equal(submitted,secret))return json({ok:false,error:'Unauthorized'},401);
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'');
 if(!base||!key)return json({ok:false,error:'Server database configuration missing'},503);
 let input;try{input=await request.json()}catch{return json({ok:false,error:'Invalid JSON'},400)}
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='replyId'&&k!=='dryRun')||!Number.isSafeInteger(input.replyId)||input.replyId<=0||typeof input.dryRun!=='boolean')return json({ok:false,error:'Invalid dispatch request'},400);
 const gates={sendingEnabled:env.CRM_EMAIL_REPLY_SENDING_ENABLED==='true',launchApproved:env.CRM_EMAIL_REPLY_GLOBAL_LAUNCH_APPROVED==='true',acknowledged:env.CRM_EMAIL_REPLY_GLOBAL_LAUNCH_ACK==='reviewed_support_reply_v1'};
 if(input.dryRun){
  let primaryMailboxConfigured=false;
  try{
   const primary=await rpc(base,key,'crm_get_zoho_mailbox_auth',{p_department:'administrator'});
   primaryMailboxConfigured=String(primary?.mailbox_address||'').toLowerCase()==='admin@fashionfussion.in'&&Boolean(primary?.refresh_token)&&/^\d{5,30}$/.test(String(primary?.zoho_account_id||''));
  }catch{}
  const oauthConfigurationPresence=Object.fromEntries(Object.values(ROUTES).map(r=>{
   const clientId=env[r.prefix+'_CLIENT_ID']||env.ZOHO_CLIENT_ID,clientSecret=env[r.prefix+'_CLIENT_SECRET']||env.ZOHO_CLIENT_SECRET;
   const mailboxConfigured=primaryMailboxConfigured||Boolean(env[r.prefix+'_REFRESH_TOKEN']&&env[r.prefix+'_MAIL_ACCOUNT_ID']);
   return[r.from,Boolean(clientId&&clientSecret&&mailboxConfigured)];
  }));
  return json({ok:true,dryRun:true,readyToAttempt:false,gates,oauthConfigurationPresence,messagesSent:0});
 }
 if(!gates.sendingEnabled||!gates.launchApproved||!gates.acknowledged)return json({ok:false,error:'CRM email reply launch gates are closed'},423);
 let claimed;
 try{
  // Resolve sender from private outbox before claim; orders@ is only routed from its dedicated orders mailbox queue.
  const pre=await fetch(base+'/rest/v1/crm_email_reply_outbox?id=eq.'+input.replyId+'&select=id,from_email,status,attempt_count,inbound_event_id&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
  const rows=await pre.json().catch(()=>[]);
  const row=Array.isArray(rows)?rows[0]:null;const route=row&&ROUTES[String(row.from_email||'').toLowerCase()];
  if(!pre.ok||!row||!route||row.status!=='ready'||row.attempt_count!==0)return json({ok:false,error:'Reply is not ready or its sender mailbox is not allowlisted'},409);
  const original=await fetch(base+'/rest/v1/crm_email_inbound_events?id=eq.'+encodeURIComponent(row.inbound_event_id)+'&select=zoho_message_id&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
  const originalRows=await original.json().catch(()=>[]);const zohoMessageId=Array.isArray(originalRows)?String(originalRows[0]?.zoho_message_id||''):'';
  if(!original.ok||!/^\d{1,80}$/.test(zohoMessageId))return json({ok:false,error:'Original Zoho message ID is missing; reply was not sent'},409);
  // OAuth setup stores mailbox refresh tokens and account IDs in Supabase Vault.
  // Retain env credentials as a fallback while older deployments migrate.
  let mailbox=await rpc(base,key,'crm_get_zoho_mailbox_auth',{p_department:route.department});
  if(!mailbox?.refresh_token||!mailbox?.zoho_account_id)mailbox=await rpc(base,key,'crm_get_zoho_mailbox_auth',{p_department:'administrator'});
  const hasVaultMailbox=Boolean(mailbox?.refresh_token&&mailbox?.zoho_account_id);
  const refreshToken=hasVaultMailbox?String(mailbox.refresh_token):String(env[route.prefix+'_REFRESH_TOKEN']||'');
  const accountId=String(hasVaultMailbox?mailbox.zoho_account_id:env[route.prefix+'_MAIL_ACCOUNT_ID']||'');
  if(!/^\d{5,30}$/.test(accountId))return json({ok:false,error:'Mailbox account configuration is invalid'},503);
  const accessToken=await tokenFor(env,route,refreshToken);
  claimed=await rpc(base,key,'claim_crm_email_reply',{p_reply_id:input.replyId});
  if(!claimed?.claimed)return json({ok:false,error:'Reply could not be claimed; no message sent'},409);
  if(claimed.fromEmail!==route.from||claimed.toEmail===route.from||!/^\S+@\S+\.\S+$/.test(claimed.toEmail))throw new Error('Claimed recipient/sender validation failed');
  const mailApiBase=String(env.ZOHO_MAIL_API_BASE||'https://mail.zoho.in/api').replace(/\/+$/,'');
  const mailApiUrl=new URL(mailApiBase);
  if(mailApiUrl.protocol!=='https:'||!/^mail\.zoho\.(in|com|eu|com\.au|jp|ca|sa|uk)$/.test(mailApiUrl.hostname)||mailApiUrl.pathname!=='/api')throw new Error('Zoho Mail API region configuration is invalid');
  const content='<p>'+String(claimed.text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</p>';
  const response=await fetch(mailApiBase+'/accounts/'+accountId+'/messages/'+encodeURIComponent(zohoMessageId),{method:'POST',headers:{Authorization:'Zoho-oauthtoken '+accessToken,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({fromAddress:route.from,toAddress:claimed.toEmail,content,action:'reply',mailFormat:'html',encoding:'UTF-8'}),redirect:'error'});
  const provider=await response.json().catch(()=>null);
  const providerMessageId=provider?.data?.messageId||provider?.data?.message_id||provider?.messageId||null;
  if(!response.ok||!providerMessageId){
   await rpc(base,key,'finish_crm_email_reply',{p_reply_id:input.replyId,p_provider_message_id:null,p_error_code:'ZOHO_SEND_REJECTED'});
   return json({ok:false,error:'Zoho did not confirm acceptance; this reply will not be retried automatically'},502);
  }
  await rpc(base,key,'finish_crm_email_reply',{p_reply_id:input.replyId,p_provider_message_id:String(providerMessageId).slice(0,255),p_error_code:null});
  return json({ok:true,accepted:true,replyId:input.replyId,retryAllowed:false,message:'Zoho accepted the email. Inbox delivery is not confirmed.'});
 }catch(error){
  if(claimed?.claimed){try{await rpc(base,key,'finish_crm_email_reply',{p_reply_id:input.replyId,p_provider_message_id:null,p_error_code:'PROVIDER_OUTCOME_UNCERTAIN'})}catch{}}
  return json({ok:false,error:'Dispatch failed or provider outcome is uncertain; automatic retry is disabled'},502);
 }
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{'Allow':'POST, OPTIONS'}})}
export async function onRequest({request}){return json({ok:false,error:'Method not allowed'},405)}


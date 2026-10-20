function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
async function digest(v){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v||'')))}
async function equal(a,b){const[x,y]=await Promise.all([digest(a),digest(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0}
const ROUTES={
 'customer.care@fashionfussion.in':{prefix:'ZOHO_CRM_CUSTOMER_CARE',from:'customer.care@fashionfussion.in'},
 'seller.support@fashionfussion.in':{prefix:'ZOHO_CRM_SELLER_SUPPORT',from:'seller.support@fashionfussion.in'},
 'sales.team@fashionfussion.in':{prefix:'ZOHO_CRM_SALES_TEAM',from:'sales.team@fashionfussion.in'}
};
async function rpc(base,key,name,body){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw new Error('Database dispatch state update failed');
 return r.json();
}
async function tokenFor(env,prefix){
 const clientId=String(env[prefix+'_CLIENT_ID']||''),clientSecret=String(env[prefix+'_CLIENT_SECRET']||''),refresh=String(env[prefix+'_REFRESH_TOKEN']||'');
 if(!clientId||!clientSecret||!refresh)throw new Error('Mailbox OAuth is not configured');
 const url=new URL('https://accounts.zoho.in/oauth/v2/token');url.searchParams.set('refresh_token',refresh);url.searchParams.set('client_id',clientId);url.searchParams.set('client_secret',clientSecret);url.searchParams.set('grant_type','refresh_token');
 const r=await fetch(url,{method:'POST',headers:{Accept:'application/json'}});
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
 if(input.dryRun)return json({ok:true,dryRun:true,readyToAttempt:false,gates,oauthConfigurationPresence:Object.fromEntries(Object.values(ROUTES).map(r=>[r.from,Boolean(env[r.prefix+'_CLIENT_ID']&&env[r.prefix+'_CLIENT_SECRET']&&env[r.prefix+'_REFRESH_TOKEN']&&env[r.prefix+'_MAIL_ACCOUNT_ID'])])),messagesSent:0});
 if(!gates.sendingEnabled||!gates.launchApproved||!gates.acknowledged)return json({ok:false,error:'CRM email reply launch gates are closed'},423);
 let claimed;
 try{
  // Resolve sender from private outbox before claim; never use orders@ for support replies.
  const pre=await fetch(base+'/rest/v1/crm_email_reply_outbox?id=eq.'+input.replyId+'&select=id,from_email,status,attempt_count&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
  const rows=await pre.json().catch(()=>[]);
  const row=Array.isArray(rows)?rows[0]:null;const route=row&&ROUTES[String(row.from_email||'').toLowerCase()];
  if(!pre.ok||!row||!route||row.status!=='ready'||row.attempt_count!==0)return json({ok:false,error:'Reply is not ready or its sender mailbox is not allowlisted'},409);
  const accountId=String(env[route.prefix+'_MAIL_ACCOUNT_ID']||'');
  if(!/^\d{5,30}$/.test(accountId))return json({ok:false,error:'Mailbox account configuration is invalid'},503);
  const accessToken=await tokenFor(env,route.prefix);
  claimed=await rpc(base,key,'claim_crm_email_reply',{p_reply_id:input.replyId});
  if(!claimed?.claimed)return json({ok:false,error:'Reply could not be claimed; no message sent'},409);
  if(claimed.fromEmail!==route.from||claimed.toEmail===route.from||!/^\S+@\S+\.\S+$/.test(claimed.toEmail))throw new Error('Claimed recipient/sender validation failed');
  const response=await fetch('https://mail.zoho.in/api/accounts/'+accountId+'/messages',{method:'POST',headers:{Authorization:'Zoho-oauthtoken '+accessToken,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({fromAddress:route.from,toAddress:claimed.toEmail,subject:claimed.subject,content:claimed.text,mailFormat:'plaintext',askReceipt:'no'})});
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

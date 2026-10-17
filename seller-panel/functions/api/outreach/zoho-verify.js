import { zohoSenderConfiguration } from './zoho-order-sender.js';
// Internal Zoho OAuth/account readiness verification. NEVER sends an email.
// Requires OUTREACH_API_TOKEN; does not reveal tokens, mailboxes or account IDs.
function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }});
}
async function digest(value){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value||'')));
}
async function authorized(request,env){
  if(!env.OUTREACH_API_TOKEN)return false;
  const authorization=request.headers.get('authorization')||'';
  const supplied=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  const [a,b]=await Promise.all([digest(supplied),digest(env.OUTREACH_API_TOKEN)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
function fromAllowed(account,from){
  const normalized=String(from||'').trim().toLowerCase();
  const activeSendAddresses=Array.isArray(account?.sendMailDetails)
    ? account.sendMailDetails.filter(row=>row?.status===true).map(row=>String(row.fromAddress||'').trim().toLowerCase())
    : [];
  const primary=String(account?.primaryEmailAddress||account?.mailboxAddress||'').trim().toLowerCase();
  // Mailbox's primary address is valid even when sendMailDetails was omitted.
  return Boolean(normalized && (activeSendAddresses.includes(normalized) || primary===normalized));
}
function secureZohoBase(value,fallback,expectedHost){
  const base=String(value||fallback).replace(/\/$/,'');
  const url=new URL(base);
  if(url.protocol!=='https:'||url.hostname!==expectedHost||url.username||url.password||url.port||url.pathname!=='/')
    throw new Error('Invalid Zoho API host setting');
  return base;
}
async function checkZoho(env,purpose='outreach'){
  const sender=zohoSenderConfiguration(env,purpose);
  if(sender.missingConfiguration.length) return {
    ready:false,oauthRefreshOk:false,accountFound:false,fromAddressAuthorized:false,mailboxEnabled:false,
    missingConfiguration:sender.missingConfiguration,
    issue:'ZOHO_CONFIGURATION_MISSING'
  };
  const accounts=secureZohoBase(env.ZOHO_ACCOUNTS_BASE_URL,'https://accounts.zoho.in','accounts.zoho.in');
  const mail=secureZohoBase(env.ZOHO_MAIL_BASE_URL,'https://mail.zoho.in','mail.zoho.in');
  const body=new URLSearchParams({
    client_id:sender.clientId,
    client_secret:sender.clientSecret,
    refresh_token:sender.refreshToken,
    grant_type:'refresh_token',
  });
  const oauth=await fetch(accounts+'/oauth/v2/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
    body:body.toString(),cache:'no-store'
  });
  const grant=await oauth.json().catch(()=>({}));
  if(!oauth.ok||!grant?.access_token){
    // Expose only Zoho's machine-readable error code; never return error_description,
    // OAuth response bodies, credentials, refresh tokens, or access tokens.
    const rawProviderError=String(grant?.error||'UNKNOWN').slice(0,48);
    const providerErrorCode=/^[A-Za-z0-9_-]{1,48}$/.test(rawProviderError)?rawProviderError:'UNKNOWN';
    return {
      ready:false,oauthRefreshOk:false,accountFound:false,fromAddressAuthorized:false,mailboxEnabled:false,
      issue:'ZOHO_OAUTH_REFRESH_FAILED',providerErrorCode
    };
  }
  const lookup=await fetch(mail+'/api/accounts',{
    method:'GET',
    headers:{Authorization:'Zoho-oauthtoken '+grant.access_token,Accept:'application/json'},
    cache:'no-store'
  });
  const payload=await lookup.json().catch(()=>({}));
  const success=lookup.ok && Number(payload?.status?.code??200)===200 && Array.isArray(payload?.data);
  if(!success)return {
    ready:false,oauthRefreshOk:true,accountFound:false,fromAddressAuthorized:false,mailboxEnabled:false,
    issue:'ZOHO_ACCOUNT_READ_FAILED'
  };
  const account=payload.data.find(row=>String(row?.accountId??'')===sender.accountId);
  const accountFound=Boolean(account);
  const fromAddressAuthorized=fromAllowed(account,sender.fromAddress);
  const mailboxEnabled=accountFound && account.enabled!==false &&
    account.outgoingBlocked!==true && account.mailboxStatus!=='disabled';
  const ready=Boolean(accountFound && fromAddressAuthorized && mailboxEnabled);
  return {
    ready,oauthRefreshOk:true,accountFound,fromAddressAuthorized,
    mailboxEnabled,
    // No message was sent: CREATE scope / actual delivery is not proved by GET /api/accounts.
    sendPermissionAndDeliveryTested:false,
    purpose,
    senderIsSeparateMailbox:purpose==='order_confirmation',
    issue:ready?null:!accountFound?'ZOHO_ACCOUNT_ID_NOT_FOUND':
      !fromAddressAuthorized?(purpose==='order_confirmation'?'ZOHO_ORDERS_ADDRESS_NOT_AUTHORIZED':'ZOHO_FROM_ADDRESS_NOT_AUTHORIZED'):'ZOHO_MAILBOX_DISABLED'
  };
}
export async function onRequestPost({request,env}){
  if(!(await authorized(request,env)))return json({error:'Unauthorized'},401);
  let body;try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
  if(body?.dryRun!==true)return json({error:'Only dryRun:true is supported. No emails are sent.'},400);
  const purpose=body?.purpose??'outreach';
  if(!['outreach','order_confirmation'].includes(purpose)){
    return json({error:'Unsupported Zoho sender purpose'},400);
  }
  const missing=zohoSenderConfiguration(env,purpose).missingConfiguration;
  if(missing.length)return json({
    ready:false,dryRun:true,sent:0,missingConfiguration:missing,
    issue:'ZOHO_CONFIGURATION_MISSING'
  },503);
  try{
    const result=await checkZoho(env,purpose);
    return json({dryRun:true,sent:0,provider:'zoho_mail',...result},result.ready?200:503);
  }catch(e){
    console.error('Zoho configuration check failed',String(e?.message||e).slice(0,120));
    return json({dryRun:true,sent:0,ready:false,issue:'ZOHO_READINESS_TEMPORARILY_UNAVAILABLE'},503);
  }
}

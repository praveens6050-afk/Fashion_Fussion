import { zohoSenderConfiguration } from './zoho-order-sender.js';

// Manual integration test, NEVER linked to an order / notification queue.
// Requires the private outreach bearer and explicit operator confirmation.
// Deliberately restricted to a single fixed test recipient.
const TEST_RECIPIENT='ps4038267@gmail.com';
function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store', 'x-content-type-options':'nosniff'
  }});
}
async function digest(text){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text||'')));
}
async function authorized(request,env){
  if(!env.OUTREACH_API_TOKEN)return false;
  const header=request.headers.get('authorization')||'';
  const raw=header.startsWith('Bearer ')?header.slice(7):'';
  const [a,b]=await Promise.all([digest(raw),digest(env.OUTREACH_API_TOKEN)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
function senderAuthorized(account,address){
  if(!account)return false;
  const normalized=address.trim().toLowerCase();
  const primary=String(account.primaryEmailAddress||account.mailboxAddress||'').trim().toLowerCase();
  const aliases=Array.isArray(account.sendMailDetails)?account.sendMailDetails:[];
  return primary===normalized ||
    aliases.some(item=>item?.status===true&&String(item.fromAddress||'').trim().toLowerCase()===normalized);
}
async function sendOneOrdersTestEmail(env){
  const sender=zohoSenderConfiguration(env,'order_confirmation');
  if(sender.missingConfiguration.length)return {status:503,body:{
    accepted:false,error:'Orders mailbox configuration missing',
    missingConfiguration:sender.missingConfiguration
  }};
  // Fixed India-domain endpoints, not customizable via public request parameters.
  const oauth=await fetch('https://accounts.zoho.in/oauth/v2/token',{
    method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
    body:new URLSearchParams({
      client_id:sender.clientId,client_secret:sender.clientSecret,
      refresh_token:sender.refreshToken,grant_type:'refresh_token'
    }).toString()
  });
  const tokens=await oauth.json().catch(()=>({}));
  if(!oauth.ok||!tokens.access_token)return {status:502,body:{
    accepted:false,error:'Orders OAuth refresh failed. No email was submitted.'
  }};
  const headers={
    Authorization:'Zoho-oauthtoken '+tokens.access_token,Accept:'application/json'
  };
  const lookup=await fetch('https://mail.zoho.in/api/accounts',{
    method:'GET',cache:'no-store',headers
  });
  const data=await lookup.json().catch(()=>({}));
  if(!lookup.ok||!Array.isArray(data.data)||Number(data?.status?.code??200)!==200)
    return {status:502,body:{accepted:false,error:'Orders account verification failed. No email submitted.'}};
  const account=data.data.find(row=>String(row?.accountId||'')===sender.accountId);
  if(!senderAuthorized(account,sender.fromAddress)||account?.outgoingBlocked===true||
     account?.enabled===false||account?.mailboxStatus==='disabled')
    return {status:503,body:{accepted:false,error:'Orders sender is not authorized. No email submitted.'}};

  // Create the fixed, explicitly identified test. Never use a real order reference.
  const testRef=new Date().toISOString();
  const message={
    fromAddress:sender.fromAddress,
    toAddress:TEST_RECIPIENT,
    subject:'[TEST ONLY] Fashion Fussion Orders Mail - '+testRef,
    content:'<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172038">'
      +'<h2>Fashion Fussion - Orders Mail Integration Test</h2>'
      +'<p>This message confirms a manual test of the orders@fashionfussion.in mailbox.</p>'
      +'<p><strong>No customer order, payment or shipment was created.</strong></p>'
      +'<p>Test reference: '+testRef+'</p>'
      +'<p>Fashion Fussion</p></body></html>',
    mailFormat:'html',askReceipt:'no'
  };
  // A network failure after this point has an UNKNOWN send outcome. Never auto-retry.
  let sent;
  try {
    sent=await fetch('https://mail.zoho.in/api/accounts/'+encodeURIComponent(sender.accountId)+'/messages',{
      method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify(message)
    });
  }catch{
    return {status:502,body:{
      accepted:false,uncertainOutcome:true,error:'Zoho send outcome unknown. Check Sent folder before retrying.'
    }};
  }
  const response=await sent.json().catch(()=>null);
  const providerCode=response?.status?.code;
  const accepted=sent.ok && (providerCode==null||Number(providerCode)===200);
  return {status:accepted?200:502,body:{
    accepted,sent:accepted?1:0,provider:'zoho_mail',
    fromAddress:sender.fromAddress,toAddress:TEST_RECIPIENT,
    reference:testRef,
    deliveryConfirmed:false,
    ...(accepted?{message:'Zoho accepted one Orders test email. Confirm arrival in recipient inbox.'}:
      {error:'Zoho did not confirm accepting the Orders test email. Check Sent before retrying.'})
  }};
}
export async function onRequestPost({request,env}){
  if(!(await authorized(request,env)))return json({error:'Unauthorized'},401);
  let body;
  try {body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||
     body.confirmOrdersTestSend!==true||body.to!==TEST_RECIPIENT||
     Object.keys(body).sort().join(',')!=='confirmOrdersTestSend,to')
    return json({error:'Explicit confirmation and fixed recipient required. No email sent.'},400);
  try {
    const response=await sendOneOrdersTestEmail(env);
    return json(response.body,response.status);
  }catch{
    // Do not log credentials or provider response; sending may be ambiguous.
    return json({accepted:false,uncertainOutcome:true,error:
      'Orders test failed or outcome unknown. Check Sent and recipient inbox before retrying.'},502);
  }
}

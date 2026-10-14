// Server-only Cloudflare Pages health check for the shared Zoho order-event secret.
// Never sends mail, creates orders, reads buyer records, or returns the secret.
// Seller's *server* may call this with the shared 40+ character bearer over HTTPS.
const respond=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'
  }
});
async function digest(text){
  return new Uint8Array(await crypto.subtle.digest(
    'SHA-256',new TextEncoder().encode(String(text||''))));
}
async function matches(left,right){
  const [a,b]=await Promise.all([digest(left),digest(right)]);
  let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];return delta===0;
}
export async function onRequestPost({request,env}){
  const configured=String(env.ZOHO_ORDER_EVENT_TOKEN||'').trim();
  if(configured.length<40)return respond({linked:false,error:'Customer order-event token not configured'},503);
  const header=request.headers.get('authorization')||'';
  const caller=header.startsWith('Bearer ')?header.slice(7):'';
  if(!caller||!(await matches(caller,configured)))return respond({linked:false,error:'Unauthorized'},401);
  let payload;
  try{payload=await request.json()}catch{return respond({linked:false,error:'Invalid JSON'},400)}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
      payload.purpose!=='order_event_link_probe'||Object.keys(payload).join(',')!=='purpose'){
    return respond({linked:false,error:'Invalid probe'},400);
  }
  return respond({
    linked:true,
    customerHookEnabled:env.FF_ORDER_EMAIL_HOOK_ENABLED==='true',
    emailSent:false,orderCreated:false
  });
}
export function onRequestGet(){return respond({error:'Method not allowed'},405);}

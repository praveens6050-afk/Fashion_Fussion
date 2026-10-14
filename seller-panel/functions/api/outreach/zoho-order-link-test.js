// Operator-authorized Customer ↔ Seller secret handshake.
// This sends ONLY the stored, server-side service bearer to the fixed Customer
// hostname. No browser ever sees it. It never invokes the mail dispatcher.
// Customer's canonical origin is www.fashionfussion.in; apex 301 redirects POST.
// Call canonical host directly; do not follow redirects with the bearer.
const CUSTOMER_ENDPOINT='https://www.fashionfussion.in/api/order-mail-link-probe';
// A 530 on the custom domain can indicate Cloudflare same-zone Worker routing.
// The project-owned Pages domain is in a different Cloudflare zone. Only use
// this exact known host for status 530, never after an auth/WAF rejection.
const CUSTOMER_FALLBACK_ENDPOINT=
  'https://fashion-fussion-customer.pages.dev/api/order-mail-link-probe';
const respond=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'}
});
async function digest(v){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v||''))));
}
async function isOperator(req,env){
  if(!env.OUTREACH_API_TOKEN)return false;
  const h=req.headers.get('authorization')||'';
  const bearer=h.startsWith('Bearer ')?h.slice(7):'';
  const [a,b]=await Promise.all([digest(bearer),digest(env.OUTREACH_API_TOKEN)]);
  let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];return delta===0;
}
export async function onRequestPost({request,env}){
  if(!(await isOperator(request,env)))return respond({connected:false,error:'Unauthorized'},401);
  let input;
  try{input=await request.json()}catch{return respond({connected:false,error:'Invalid JSON'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input)||
     input.dryRun!==true||Object.keys(input).join(',')!=='dryRun'){
    return respond({connected:false,error:'Only dryRun:true is permitted'},400);
  }
  const serviceToken=String(env.ZOHO_ORDER_EVENT_TOKEN||'').trim();
  if(serviceToken.length<40)return respond({connected:false,error:'Seller service secret missing or too short'},503);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const checkEndpoint=(endpoint)=>fetch(endpoint,{
      method:'POST',cache:'no-store',signal:controller.signal,redirect:'manual',
      headers:{
        Authorization:'Bearer '+serviceToken,
        'Content-Type':'application/json',
        Accept:'application/json'
      },
      body:JSON.stringify({purpose:'order_event_link_probe'})
    });
    let response=await checkEndpoint(CUSTOMER_ENDPOINT);
    let endpointUsed='custom_domain';
    // Do not retry any 401/403/404/503, never bypass Customer access policy.
    // 530 is Cloudflare's inter-Worker routing/network response; this is NOT
    // a customer-authentication result. The second target is a fixed project host.
    if(response.status===530){
      response=await checkEndpoint(CUSTOMER_FALLBACK_ENDPOINT);
      endpointUsed='pages_dev_fallback';
    }
    // Do not forward untrusted Customer responses, URLs, headers, or any secret.
    // A Cloudflare challenge can be HTML with status 403/530/200.
    const responseType=String(response.headers?.get('content-type')||'').toLowerCase();
    const isJson=responseType.includes('application/json');
    const data=isJson?await response.json().catch(()=>null):null;
    if(response.ok&&data?.linked===true&&data?.emailSent===false&&data?.orderCreated===false){
      return respond({
        connected:true,customerSecretMatchesSeller:true,
        endpointUsed,
        customerHookEnabled:data.customerHookEnabled===true,
        sellerSendingEnabled:env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true',
        automaticEmailSent:false,orderCreated:false,
        note:'Verified private server-to-server bearer; no order or Zoho mail request was made.'
      });
    }
    const customerError=typeof data?.error==='string'?data.error:'';
    const failureCode=
      response.status===401&&isJson&&customerError==='Unauthorized'?'SERVICE_TOKEN_MISMATCH':
      response.status===503&&isJson&&customerError==='Customer order-event token not configured'?'CUSTOMER_SECRET_NOT_CONFIGURED':
      response.status===404?'CUSTOMER_PROBE_ROUTE_NOT_FOUND':
      response.status===530?'CLOUDFLARE_WORKER_ROUTING_FAILURE':
      response.status===403?'CUSTOMER_ACCESS_DENIED':
      response.status>=300&&response.status<400?'CUSTOMER_ENDPOINT_REDIRECT':
      response.status===405?'CUSTOMER_ENDPOINT_METHOD_REJECTED':
      response.ok&&!isJson?'CUSTOMER_UNEXPECTED_HTML':
      response.ok?'CUSTOMER_PROBE_RESPONSE_INVALID':
      'CUSTOMER_ENDPOINT_HTTP_FAILURE';
    return respond({
      connected:false,customerSecretMatchesSeller:false,
      customerHttpStatus:response.status,endpointUsed,
      customerResponseType:isJson?'json':'non_json',
      diagnosticCode:failureCode,
      customerHookEnabled:null,
      sellerSendingEnabled:env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true',
      automaticEmailSent:false,orderCreated:false,
      error:failureCode==='SERVICE_TOKEN_MISMATCH'?'Customer and Seller event token values differ':
            failureCode==='CUSTOMER_SECRET_NOT_CONFIGURED'?'Customer event secret is not available at runtime':
            failureCode==='CUSTOMER_PROBE_ROUTE_NOT_FOUND'?'Customer probe route not deployed or intercepted':
            failureCode==='CLOUDFLARE_WORKER_ROUTING_FAILURE'?'Cloudflare server-to-server routing failed':
            failureCode==='CUSTOMER_ACCESS_DENIED'?'Customer endpoint blocked by access/security rule':
            failureCode==='CUSTOMER_ENDPOINT_REDIRECT'?'Customer endpoint unexpectedly redirected':
            failureCode==='CUSTOMER_UNEXPECTED_HTML'?'Customer returned HTML instead of probe JSON':
            'Customer connection failed; check diagnostic code and HTTP status'
    },503);
  }catch{
    return respond({
      connected:false,
      diagnosticCode:'CUSTOMER_NETWORK_FAILURE',
      error:'Customer probe unreachable or timed out',
      automaticEmailSent:false,orderCreated:false
    },503);
  }finally{
    clearTimeout(timer);
  }
}
export function onRequestGet(){return respond({error:'Method not allowed'},405);}

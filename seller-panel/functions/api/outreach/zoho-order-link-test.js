// Operator-authorized Customer ↔ Seller secret handshake.
// This sends ONLY the stored, server-side service bearer to the fixed Customer
// hostname. No browser ever sees it. It never invokes the mail dispatcher.
const CUSTOMER_ENDPOINT='https://fashionfussion.in/api/order-mail-link-probe';
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
    const response=await fetch(CUSTOMER_ENDPOINT,{
      method:'POST',cache:'no-store',signal:controller.signal,
      headers:{
        Authorization:'Bearer '+serviceToken,
        'Content-Type':'application/json',
        Accept:'application/json'
      },
      body:JSON.stringify({purpose:'order_event_link_probe'})
    });
    const data=await response.json().catch(()=>null);
    if(response.ok&&data?.linked===true&&data?.emailSent===false&&data?.orderCreated===false){
      return respond({
        connected:true,customerSecretMatchesSeller:true,
        customerHookEnabled:data.customerHookEnabled===true,
        sellerSendingEnabled:env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true',
        automaticEmailSent:false,orderCreated:false,
        note:'Verified private server-to-server bearer; no order or Zoho mail request was made.'
      });
    }
    return respond({
      connected:false,customerSecretMatchesSeller:false,
      customerHttpStatus:response.status,
      customerHookEnabled:null,
      sellerSendingEnabled:env.ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED==='true',
      automaticEmailSent:false,orderCreated:false,
      error:response.status===401?'Customer and Seller order-event secrets do not match':
            response.status===503?'Customer order-event secret is missing':
            response.status===404?'Customer probe endpoint is not deployed':
            'Customer connection failed'
    },503);
  }catch{
    return respond({
      connected:false,error:'Customer probe unreachable or timed out',
      automaticEmailSent:false,orderCreated:false
    },503);
  }finally{
    clearTimeout(timer);
  }
}
export function onRequestGet(){return respond({error:'Method not allowed'},405);}

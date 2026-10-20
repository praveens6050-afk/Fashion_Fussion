function json(body,status,origin,headers={}) {
  return new Response(JSON.stringify(body),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin',
    ...(origin?{'Access-Control-Allow-Origin':origin}:{}),...headers
  }});
}
function allowedOrigins(env) {
  return [...new Set(String(env.ALLOWED_ORIGIN||'').split(',').map(v=>v.trim()).filter(Boolean))];
}
export async function onRequestOptions({request,env}) {
  const origin=request.headers.get('Origin')||'';
  if(origin&&!allowedOrigins(env).includes(origin))return json({ok:false,error:'Origin not allowed'},403,'');
  return new Response(null,{status:204,headers:{
    ...(origin?{'Access-Control-Allow-Origin':origin}:{}),
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin'
  }});
}
export async function onRequestPost({request,env}) {
  const origin=request.headers.get('Origin')||'';
  if(origin&&!allowedOrigins(env).includes(origin))return json({ok:false,error:'Origin not allowed'},403,'');
  const authorization=request.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer ')||!authorization.slice(7).trim())
    return json({ok:false,error:'Please sign in again'},401,origin);
  const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||'');
  if(!base||!key||!allowedOrigins(env).length)
    return json({ok:false,error:'CRM support inbox is not configured'},503,origin);
  let input;
  try{input=await request.json()}catch{return json({ok:false,error:'Invalid request'},400,origin);}
  if(!input||typeof input!=='object'||Array.isArray(input))
    return json({ok:false,error:'Invalid request'},400,origin);
  const action=input.action;
  let rpc,body;
  if(action==='snapshot'&&Object.keys(input).length===1){
    rpc='admin_crm_whatsapp_support_snapshot';body={};
  }else if(action==='queue_reply'&&Object.keys(input).sort().join(',')==='action,inboundEventId,replyText,requestKey'
    &&Number.isSafeInteger(input.inboundEventId)&&input.inboundEventId>0
    &&typeof input.replyText==='string'&&input.replyText.trim().length>=1
    &&input.replyText.trim().length<=1000
    &&typeof input.requestKey==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(input.requestKey)){
    rpc='admin_crm_queue_whatsapp_reply';
    body={p_inbound_event_id:input.inboundEventId,p_reply_text:input.replyText.trim(),p_request_key:input.requestKey};
  }else return json({ok:false,error:'Invalid support inbox action'},400,origin);
  const headers={apikey:key,Authorization:authorization,'Content-Type':'application/json',Accept:'application/json'};
  try{
    const userResponse=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization}});
    const user=await userResponse.json().catch(()=>null);
    if(!userResponse.ok||!user?.id)return json({ok:false,error:'Please sign in again'},401,origin);
    // Authorization is enforced inside the SECURITY DEFINER RPC using auth.uid().
    // This permits scoped team members without exposing the broader admin CRM.
    const response=await fetch(base+'/rest/v1/rpc/'+rpc,{method:'POST',headers,body:JSON.stringify(body)});
    if(!response.ok)return json({ok:false,error:response.status===401?'Please sign in again':
      response.status===403?'CRM team access is missing or this conversation belongs to another queue':
      response.status===22023?'Invalid reply request':'WhatsApp support inbox is temporarily unavailable'},
      response.status===401?401:response.status===403?403:503,origin);
    const data=await response.json().catch(()=>null);
    return json({ok:true,data:data&&typeof data==='object'?data:{}},200,origin);
  }catch{return json({ok:false,error:'WhatsApp support inbox is temporarily unavailable'},503,origin);}
}
export async function onRequest({request}) {
  return json({ok:false,error:'Method not allowed'},405,request.headers.get('Origin')||'',{
    'Allow':'POST, OPTIONS','Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization'
  });
}

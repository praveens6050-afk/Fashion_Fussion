function json(body,status=200,extraHeaders={}){
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extraHeaders});
  return new Response(JSON.stringify(body),{status,headers});
}

async function sha256Hex(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function isSameOriginBrowserRequest(request){
  const expectedOrigin=new URL(request.url).origin;
  const origin=request.headers.get('Origin');
  const fetchSite=request.headers.get('Sec-Fetch-Site');
  if(origin&&origin!==expectedOrigin)return false;
  if(fetchSite&&fetchSite!=='same-origin')return false;
  return true;
}

export async function onRequestPost({request,env}){
  if(!isSameOriginBrowserRequest(request))return json({ok:false,error:'Cross-origin request blocked'},403);

  let body={};
  try{body=await request.json();}catch{return json({ok:false,error:'Invalid request body'},400);}
  const email=String(body.email||'').trim().toLowerCase();
  if(!email||email.length>320)return json({ok:false,error:'Valid email is required'},400);

  const supabaseUrl=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const serviceRoleKey=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!supabaseUrl||!serviceRoleKey)return json({ok:false,error:'Login protection is not configured'},503);

  const ip=(request.headers.get('CF-Connecting-IP')||request.headers.get('X-Forwarded-For')||'unknown').split(',')[0].trim();
  const rateKey='admin-login:'+await sha256Hex(`${ip}|${email}`);

  let rpcResponse;
  try{
    rpcResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/consume_admin_login_rate_limit`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':serviceRoleKey,
        'Authorization':`Bearer ${serviceRoleKey}`
      },
      body:JSON.stringify({p_key:rateKey,p_limit:8,p_window_seconds:600})
    });
  }catch{
    return json({ok:false,error:'Login protection is unavailable'},503);
  }

  if(!rpcResponse.ok)return json({ok:false,error:'Login protection is unavailable'},503);
  let rows=[];
  try{rows=await rpcResponse.json();}catch{return json({ok:false,error:'Login protection is unavailable'},503);}
  const result=Array.isArray(rows)?rows[0]:rows;
  const allowed=result?.allowed===true;
  const remaining=Math.max(0,Number(result?.remaining||0));
  const retryAfter=Math.max(0,Number(result?.retry_after_seconds||0));
  const rateHeaders={
    'X-RateLimit-Limit':'8',
    'X-RateLimit-Remaining':String(remaining),
    'X-RateLimit-Policy':'8;w=600'
  };
  if(!allowed){
    return json({ok:false,allowed:false,retry_after_seconds:retryAfter},429,{...rateHeaders,'Retry-After':String(Math.max(1,retryAfter))});
  }
  return json({ok:true,allowed:true,remaining},200,rateHeaders);
}

export function onRequestGet(){
  return json({ok:false,error:'Method not allowed'},405,{'Allow':'POST'});
}

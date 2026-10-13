// Protected read-only Zoho transactional email queue. It never dispatches email.
function json(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
async function hash(v){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v||'')))}
async function authorized(req,env){
 if(!env.OUTREACH_API_TOKEN)return false;
 const header=req.headers.get('authorization')||'';
 const supplied=header.startsWith('Bearer ')?header.slice(7):'';
 const [a,b]=await Promise.all([hash(supplied),hash(env.OUTREACH_API_TOKEN)]);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function onRequestGet({request,env}){
 if(!(await authorized(request,env)))return json({error:'Unauthorized'},401);
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
 if(!base||!key)return json({error:'Database configuration unavailable'},503);
 const params=new URL(request.url).searchParams;
 const limit=Math.min(25,Math.max(1,Number.parseInt(params.get('limit')||'10',10)||10));
 const filter=params.get('status')||'';
 if(filter&&!['pending_review','ready','sending','sent','failed','blocked'].includes(filter))return json({error:'Invalid status'},400);
 const query='select=id,order_id,event_type,status,attempt_count,provider,created_at,updated_at'
  +'&order=created_at.desc&limit='+limit+(filter?'&status=eq.'+encodeURIComponent(filter):'');
 try{
  const res=await fetch(base+'/rest/v1/zoho_order_email_outbox?'+query,{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
  if(!res.ok)throw Error('Database unavailable');
  const rows=await res.json();if(!Array.isArray(rows))throw Error('Invalid response');
  return json({provider:'zoho_mail',liveSendingEnabled:false,count:rows.length,items:rows});
 }catch(e){console.error('Zoho email outbox status unavailable',e?.message);return json({error:'Outbox query failed'},503)}
}

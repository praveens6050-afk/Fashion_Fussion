// Service-only outbox inspection. NO enqueue or WhatsApp sending actions.
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
async function sha(s){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s||'')))}
async function authorized(request,env){
  if(!env.OUTREACH_API_TOKEN)return false;
  const bearer=request.headers.get('authorization')||'';
  const token=bearer.startsWith('Bearer ')?bearer.slice(7):'';
  const [a,b]=await Promise.all([sha(token),sha(env.OUTREACH_API_TOKEN)]);
  let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];return mismatch===0;
}
export async function onRequestGet({request,env}){
  if(!(await authorized(request,env)))return json({error:'Unauthorized'},401);
  const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
  if(!base||!key)return json({error:'Server database configuration missing'},503);
  const args=new URL(request.url).searchParams;
  const status=args.get('status')||'';
  const limit=Math.max(1,Math.min(25,Number.parseInt(args.get('limit')||'10',10)||10));
  const filters='select=id,order_id,event_type,status,attempt_count,template_name,created_at,updated_at'
   +'&order=created_at.desc&limit='+limit
   +(status?'&status=eq.'+encodeURIComponent(status):'');
  try{
    const response=await fetch(base+'/rest/v1/whatsapp_order_notification_outbox?'+filters,{
      headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}
    });
    if(!response.ok)throw new Error('Outbox query failed');
    const rows=await response.json();
    if(!Array.isArray(rows))throw new Error('Unexpected database response');
    return json({dryRun:true,liveSendingEnabled:false,sent:0,count:rows.length,items:rows});
  }catch(e){console.error('WhatsApp outbox inspection failed',String(e?.message||e));return json({error:'Outbox status unavailable'},503)}
}

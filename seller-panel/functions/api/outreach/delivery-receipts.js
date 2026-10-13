// Internal read-only Meta WhatsApp delivery receipt view.
// Does not send messages, modify status or expose customer phone numbers.
function json(value,status=200) {
  return new Response(JSON.stringify(value), {status,headers:{
    'content-type':'application/json; charset=UTF-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }});
}
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value||'')));
}
async function authorized(request,env) {
  if (!env.OUTREACH_API_TOKEN) return false;
  const header=request.headers.get('authorization')||'';
  const supplied=header.startsWith('Bearer ')?header.slice(7):'';
  const [a,b]=await Promise.all([digest(supplied),digest(env.OUTREACH_API_TOKEN)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
const STATUSES = new Set(['sent','delivered','read','failed']);
function maskedMessageId(value) {
  const id=String(value||'');
  return id?'wamid.••••'+id.slice(-4):null;
}
export async function onRequestGet({request,env}) {
  if (!(await authorized(request,env)))return json({error:'Unauthorized'},401);
  const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
  if(!base||!key)return json({error:'Delivery receipt storage unavailable'},503);
  const params=new URL(request.url).searchParams;
  const limit=Math.min(25,Math.max(1,Number.parseInt(params.get('limit')||'10',10)||10));
  const filter=params.get('status')||'';
  if(filter && !STATUSES.has(filter))return json({error:'Invalid delivery status filter'},400);
  const query='select=id,provider_message_id,meta_status,event_at,error_code,created_at'
    +'&order=created_at.desc&limit='+limit
    +(filter?'&meta_status=eq.'+encodeURIComponent(filter):'');
  try {
    const response=await fetch(base+'/rest/v1/whatsapp_delivery_status_events?'+query,{
      headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}
    });
    if(!response.ok)throw new Error('Delivery database lookup failed');
    const rows=await response.json();
    if(!Array.isArray(rows))throw new Error('Unexpected delivery receipt records');
    return json({
      sendingEnabled:false,
      count:rows.length,
      receipts:rows.map(row=>({
        id:row.id,status:row.meta_status,providerMessage:maskedMessageId(row.provider_message_id),
        at:row.event_at,errorCode:row.error_code||null,recordedAt:row.created_at
      }))
    });
  }catch(e){
    console.error('Delivery receipts read failed',String(e?.message||e));
    return json({error:'Delivery receipt history unavailable'},503);
  }
}

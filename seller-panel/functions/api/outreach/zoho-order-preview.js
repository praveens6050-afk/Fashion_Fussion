import { buildZohoOrderEmail } from './zoho-order-templates.js';

// Internal Zoho notification readiness preview. NEVER calls the Zoho Mail API.
const EVENTS=new Set(['order_confirmed','payment_successful','shipped','out_for_delivery','delivered']);
const SHIPPING=new Set(['shipped','out_for_delivery','delivered']);
const ZOHO_KEYS=['ZOHO_CLIENT_ID','ZOHO_CLIENT_SECRET','ZOHO_REFRESH_TOKEN','ZOHO_MAIL_ACCOUNT_ID','ZOHO_MAIL_FROM_ADDRESS'];
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'
}})}
async function hash(s){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s||'')))}
async function authorized(request,env){
  if(!env.OUTREACH_API_TOKEN)return false;
  const bearer=request.headers.get('authorization')||'';
  const supplied=bearer.startsWith('Bearer ')?bearer.slice(7):'';
  const [a,b]=await Promise.all([hash(supplied),hash(env.OUTREACH_API_TOKEN)]);
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
function serverConfig(env){
 return {url:String(env.SUPABASE_URL||'').replace(/\/$/,''),key:String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'')};
}
async function query(env,table,filter){
 const {url,key}=serverConfig(env);
 if(!url||!key)throw new Error('DB configuration unavailable');
 const response=await fetch(url+'/rest/v1/'+table+'?'+filter,{headers:{
   apikey:key,Authorization:'Bearer '+key,Accept:'application/json'
 }});
 if(!response.ok)throw new Error('DB read failed');
 const rows=await response.json();
 if(!Array.isArray(rows))throw new Error('Unexpected database response');
 return rows;
}
async function confirmedAuthEmail(env,userId){
 if(!/^[0-9a-f-]{36}$/i.test(String(userId||'')))return null;
 const {url,key}=serverConfig(env);
 const response=await fetch(url+'/auth/v1/admin/users/'+encodeURIComponent(userId),{headers:{
  apikey:key,Authorization:'Bearer '+key,Accept:'application/json'
 }});
 if(!response.ok)throw new Error('Auth email verification failed');
 const user=await response.json();
 if(!user?.email_confirmed_at)return null;
 return String(user.email||'').trim().toLowerCase();
}
function orderBlockers(order,eventType,shipment){
 if(!order)return ['order_not_found'];
 const blocked=[];
 if(!order.user_id || !order.customer_email)blocked.push('customer_account_or_email_missing');
 if(['creating','created','expired','cancelled','cod_cancelled','payment_failed',
      'refund_pending','refund_initiated','refund_failed','refunded'].includes(order.status)
    || order.fulfillment_status==='cancelled')blocked.push('order_not_confirmed');
 if(!String(order.display_order_id||'').trim())blocked.push('order_reference_missing');
 if(!String(order.customer_name||'').trim())blocked.push('customer_name_missing');

 const isPrepaidVerified=order.payment_method==='prepaid'&&order.status==='paid'&&Boolean(order.payment_verified_at);
 const isCODConfirmed=order.payment_method==='cod'&&['cod_pending','cod_collected'].includes(order.status);
 if(eventType==='order_confirmed'){
  if(!isPrepaidVerified&&!isCODConfirmed)blocked.push('payment_or_cod_not_confirmed');
 }else if(eventType==='payment_successful'){
  if(!isPrepaidVerified&&!(order.payment_method==='cod'&&order.status==='cod_collected'))
    blocked.push('payment_not_verified');
 }else{
  if(order.fulfillment_status!==eventType)blocked.push('shipment_status_not_current');
  if(!isPrepaidVerified&&!isCODConfirmed)blocked.push('order_payment_state_not_eligible');
  if(!shipment||shipment.direction!=='forward'||!String(shipment.awb_code||'').trim())
    blocked.push('forward_shipment_awb_required');
  if(eventType==='delivered'&&order.payment_method==='cod'&&order.status!=='cod_collected')
    blocked.push('cod_collection_not_verified');
 }
 return [...new Set(blocked)];
}
async function preview(env,orderId,eventType){
 const [orders,queued]=await Promise.all([
  query(env,'orders','id=eq.'+orderId+'&select=id,user_id,display_order_id,customer_name,customer_email,payment_method,status,payment_verified_at,fulfillment_status&limit=1'),
  query(env,'zoho_order_email_outbox','order_id=eq.'+orderId+'&event_type=eq.'+eventType+'&select=id,event_type,status,attempt_count,created_at&limit=1'),
 ]);
 const order=orders[0]||null, item=queued[0]||null;
 const blockers=orderBlockers(order,eventType,null).filter(x=>x!=='forward_shipment_awb_required');
 if(!item)blockers.push('verified_event_not_staged');
 else if(item.status!=='pending_review')blockers.push('queue_event_already_processed_or_reviewed');
 let shipment=null;
 if(order&&SHIPPING.has(eventType)){
  const records=await query(env,'order_shipments',
    'order_id=eq.'+orderId+'&direction=eq.forward&select=direction,awb_code,updated_at&order=updated_at.desc&limit=1');
  shipment=records[0]||null;
 }
 const validEvent=orderBlockers(order,eventType,shipment);
 blockers.push(...validEvent);
 if(order?.user_id){
  const authEmail=await confirmedAuthEmail(env,order.user_id);
  if(!authEmail||authEmail!==String(order.customer_email||'').trim().toLowerCase())
    blockers.push('confirmed_customer_email_mismatch');
 }else blockers.push('confirmed_customer_email_mismatch');
 const missingConfiguration=ZOHO_KEYS.filter(k=>!env[k]);
 if(missingConfiguration.length)blockers.push('zoho_sender_configuration_missing');
 let template=null;
 if(order?.id && order.customer_name && order.display_order_id){
  try{
   const mail=buildZohoOrderEmail(order,eventType,{redactName:true});
   template={event:eventType,subject:mail.subject,htmlSample:mail.html};
  }catch{blockers.push('email_template_render_failed')}
 }
 return {
  dryRun:true,sent:0,liveSendingEnabled:false,provider:'zoho_mail',
  orderId:Number(orderId),eventType,orderStatus:order?.status||null,
  fulfillmentStatus:order?.fulfillment_status||null,
  outboxStatus:item?.status||null,hasVerifiedEmail:!blockers.includes('confirmed_customer_email_mismatch'),
  missingConfiguration,preview:template,eligible:[...new Set(blockers)].length===0,
  blockers:[...new Set(blockers)]
 };
}
export async function onRequestPost({request,env}){
 if(!(await authorized(request,env)))return json({error:'Unauthorized'},401);
 let body;try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
 if(body?.dryRun!==true)return json({error:'Only dryRun:true is supported. This endpoint does not send email.'},400);
 const id=String(body.orderId??'');
 if(!/^[1-9]\d{0,14}$/.test(id)||!Number.isSafeInteger(Number(id)))
  return json({error:'orderId must be a positive order ID'},400);
 if(!EVENTS.has(body.eventType))return json({error:'Unsupported order email eventType'},400);
 try{return json(await preview(env,id,body.eventType))}
 catch(e){console.error('Zoho order preview unavailable',String(e?.message||e));return json({error:'Order email preview unavailable. No email sent.'},503)}
}

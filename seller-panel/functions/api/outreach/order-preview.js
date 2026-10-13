// Server-only WhatsApp order notification readiness check. This endpoint NEVER sends.
const EVENTS = new Set(['order_confirmed', 'shipped', 'out_for_delivery', 'delivered']);
const SHIPPING = new Set(['shipped', 'out_for_delivery', 'delivered']);
function json(value, status=200) {
  return new Response(JSON.stringify(value), {status, headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }});
}
async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s||'')));
}
async function authorized(request, env) {
  if (!env.OUTREACH_API_TOKEN) return false;
  const header = request.headers.get('authorization')||'';
  const token = header.startsWith('Bearer ')?header.slice(7):'';
  const [left,right] = await Promise.all([digest(token),digest(env.OUTREACH_API_TOKEN)]);
  let different=0;
  for(let i=0;i<left.length;i++)different|=left[i]^right[i];
  return different===0;
}
function digits(phone) {return String(phone||'').replace(/\D/g,'')}
function e164(phone) {
  const raw=String(phone||'').trim();
  const n=digits(raw);
  if(/^\d{10}$/.test(n))return '+91'+n;
  if(/^91\d{10}$/.test(n))return '+'+n;
  if(raw.startsWith('+')&&/^[1-9]\d{7,14}$/.test(n))return '+'+n;
  return null;
}
function maskPhone(phone) {const n=digits(phone);return n?'••••'+n.slice(-4):null}
function keys(env) {
  return {url:String(env.SUPABASE_URL||'').replace(/\/$/,''),token:String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'')};
}
async function dbRows(env, resource, params) {
  const {url,token}=keys(env);
  if(!url||!token)throw new Error('Database configuration missing');
  const response=await fetch(url+'/rest/v1/'+resource+'?'+params,{
    headers: {apikey:token,Authorization:'Bearer '+token,Accept:'application/json'},
  });
  if(!response.ok) throw new Error('Database lookup failed');
  const rows=await response.json();
  if(!Array.isArray(rows))throw new Error('Database returned unexpected response');
  return rows;
}
function orderEligible(order,eventType,shipment) {
  if (!order) return ['order_not_found'];
  const issues=[];
  if (['cancelled','cod_cancelled','expired','payment_failed','refund_pending','refund_initiated','refund_failed','refunded'].includes(order.status)
      || order.fulfillment_status==='cancelled') issues.push('order_not_active');
  if (eventType==='order_confirmed') {
    // No "order placed" event for unconfirmed COD, expired checkouts or unverified prepaid payments.
    if(order.status!=='paid'||!order.payment_verified_at) issues.push('paid_order_not_confirmed');
    if(order.fulfillment_status!=='ordered') issues.push('order_already_progressed');
  } else {
    if (!['paid','cod_pending','cod_collected'].includes(order.status))issues.push('order_payment_state_not_eligible');
    if(order.fulfillment_status!==eventType) issues.push('fulfillment_event_not_current');
    if(!shipment||!String(shipment.awb_code||'').trim()||shipment.direction!=='forward')issues.push('forward_shipment_with_awb_required');
    if(eventType==='delivered' && order.payment_method==='cod' && order.status!=='cod_collected')
      issues.push('cod_collection_not_confirmed');
  }
  return [...new Set(issues)];
}
const META_ORDER_TEMPLATE = Object.freeze({
  name: 'order_status_update',
  languageCode: 'en',
  statusLabels: Object.freeze({
    order_confirmed: 'Confirmed',
    shipped: 'Shipped',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
  }),
});
// Confirmed directly against Fashion Fussion's approved Meta template:
// Hi {{1}}, your Fashion Fussion order {{2}} status has been updated to {{3}}.
// Please check your account for the latest order details.
// No dynamic header or URL/button parameters exist.
function cleanTemplateText(input, maxLength) {
  return String(input ?? '').replace(/[\\r\\n\\t]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, maxLength);
}
function buildOrderTemplate(order, eventType) {
  if (!order || !EVENTS.has(eventType)) return {components: null, blockers:['invalid_order_template_context']};
  const customerName = cleanTemplateText(order.customer_name, 70);
  const displayOrderId = cleanTemplateText(order.display_order_id, 80);
  const statusLabel = META_ORDER_TEMPLATE.statusLabels[eventType];
  const blockers = [];
  if (!customerName) blockers.push('customer_name_missing');
  if (!displayOrderId) blockers.push('display_order_id_missing');
  if (!statusLabel) blockers.push('status_label_missing');
  if (blockers.length) return {components: null, blockers};
  return {
    components: [{
      type: 'body',
      parameters: [
        {type: 'text', text: customerName},   // {{1}} - orders.customer_name
        {type: 'text', text: displayOrderId}, // {{2}} - orders.display_order_id
        {type: 'text', text: statusLabel},    // {{3}} - verified event status
      ],
    }],
    blockers:[],
  };
}
function safeTemplatePreview(order, eventType, template) {
  return {
    name: META_ORDER_TEMPLATE.name,
    languageCode: META_ORDER_TEMPLATE.languageCode,
    bodyVariables: [
      {variable: '{{1}}', source: 'orders.customer_name', present: Boolean(cleanTemplateText(order?.customer_name, 70))},
      {variable: '{{2}}', source: 'orders.display_order_id', value: cleanTemplateText(order?.display_order_id, 80) || null},
      {variable: '{{3}}', source: 'verified_event_type', value: META_ORDER_TEMPLATE.statusLabels[eventType]},
    ],
    sampleText: template.components
      ? 'Hi [customer name], your Fashion Fussion order '
        + template.components[0].parameters[1].text
        + ' status has been updated to '
        + template.components[0].parameters[2].text
        + '. Please check your account for the latest order details.'
      : null,
  };
}
function consentValid(consent) {
  return Boolean(consent && consent.status==='opted_in' && consent.consented_at && !consent.revoked_at);
}
async function preview(env, orderId,eventType) {
  const orderRows=await dbRows(env,'orders',
    'id=eq.'+orderId+'&select=id,display_order_id,customer_name,status,fulfillment_status,payment_method,payment_verified_at,customer_phone&limit=1');
  const order=orderRows[0]||null;
  let shipment=null, optin=null;
  if(order && SHIPPING.has(eventType)){
    const shipments=await dbRows(env,'order_shipments',
      'order_id=eq.'+orderId+'&direction=eq.forward&select=id,direction,status,awb_code,updated_at&order=updated_at.desc&limit=1');
    shipment=shipments[0]||null;
  }
  const phone=order?e164(order.customer_phone):null;
  if(phone){
    const rows=await dbRows(env,'whatsapp_contact_consents',
      'phone_e164=eq.'+encodeURIComponent(phone)+'&purpose=eq.transactional&select=status,consented_at,revoked_at&limit=1');
    optin=rows[0]||null;
  }
  const blockers=orderEligible(order,eventType,shipment);
  if(!phone) blockers.push('valid_customer_whatsapp_phone_missing');
  if(!consentValid(optin)) blockers.push('transactional_whatsapp_opt_in_missing');
  const names=new Set(String(env.WHATSAPP_ALLOWED_TEMPLATES||'').split(',').map(s=>s.trim()).filter(Boolean));
  if(!names.has('order_status_update'))blockers.push('order_status_update_not_allowlisted');
  const mapped = buildOrderTemplate(order, eventType);
  blockers.push(...mapped.blockers);
  return {
    dryRun:true,sent:0,liveSendingEnabled:false,
    orderId:order?order.id:orderId,
    displayOrderId:order?.display_order_id||null,
    eventType,
    orderStatus:order?.status||null,
    fulfillmentStatus:order?.fulfillment_status||null,
    recipient:maskPhone(order?.customer_phone),
    transactionalConsentActive:consentValid(optin),
    shipmentAvailable:Boolean(shipment&&shipment.awb_code),
    template:safeTemplatePreview(order,eventType,mapped),
    // "eligible" means order + consent + template are ready for future
    // authorized workflow review, NOT permission to send via this endpoint.
    eligible:blockers.length===0,
    blockers:[...new Set(blockers)]
  };
}
export async function onRequestPost({request,env}) {
  if(!(await authorized(request,env))) return json({error:'Unauthorized'},401);
  let body;
  try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
  if(body?.dryRun!==true)return json({error:'Only dryRun:true previews are supported. No live sending is implemented.'},400);
  const orderId=String(body.orderId??'');
  if(!/^[1-9]\d{0,14}$/.test(orderId) || !Number.isSafeInteger(Number(orderId)))
    return json({error:'orderId must be a valid positive order ID'},400);
  if(!EVENTS.has(body.eventType))return json({error:'Invalid order notification eventType'},400);
  try{return json(await preview(env,orderId,body.eventType))}
  catch(e){console.error('WhatsApp order notification preview unavailable',String(e?.message||e));return json({error:'Order preview temporarily unavailable; no message sent'},503)}
}

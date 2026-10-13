// Zoho transactional email templates. Pure rendering: NO network calls / email sending.
const EVENT_DETAILS = Object.freeze({
  order_confirmed: {
    title: 'Your order is confirmed',
    subjectPrefix: 'Order confirmed',
    message: 'Your Fashion Fussion order is confirmed. You can review your order and payment details in your account.',
  },
  payment_successful: {
    title: 'Payment successful',
    subjectPrefix: 'Payment received',
    message: 'Payment for your Fashion Fussion order has been confirmed. Thank you for shopping with us.',
  },
  shipped: {
    title: 'Your order has shipped',
    subjectPrefix: 'Order shipped',
    message: 'Your Fashion Fussion order has shipped. Log in to your account for the latest shipment details.',
  },
  out_for_delivery: {
    title: 'Your order is out for delivery',
    subjectPrefix: 'Out for delivery',
    message: 'Your Fashion Fussion order is out for delivery. Please check your order details for updates.',
  },
  delivered: {
    title: 'Your order was delivered',
    subjectPrefix: 'Order delivered',
    message: 'Your Fashion Fussion order is marked as delivered. If you need help, visit your account.',
  },
});
export function escapeZohoHtml(value) {
  return String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
}
export function buildZohoOrderEmail(order,eventType,{redactName=false}={}) {
  const spec=EVENT_DETAILS[eventType];
  if(!spec)throw new Error('Unsupported Zoho notification event');
  const reference=String(order?.display_order_id || order?.id || '').trim();
  if(!reference || reference.length>100)throw new Error('Missing or invalid order reference');
  const actualName=String(order?.customer_name||'').trim().slice(0,100);
  const name=redactName?'Customer':actualName;
  if(!name)throw new Error('Missing customer name');
  const subject=spec.subjectPrefix+' — Fashion Fussion #'+reference;
  const orderUrl='https://fashionfussion.in/order-details.html?id='+encodeURIComponent(String(order.id));
  const codNote=eventType==='order_confirmed'&&String(order.payment_method)==='cod'
    ? '<p style="color:#475467;font-size:14px">Payment method: Cash on Delivery. No online payment has been charged.</p>' : '';
  const html='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#f4f5f9;font-family:Arial,sans-serif;color:#1c2532">'
    +'<main style="max-width:620px;margin:auto;background:white;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">'
    +'<div style="padding:24px 28px;background:#191b2f;color:#fff;font-weight:800;font-size:18px">Fashion Fussion</div>'
    +'<div style="padding:28px"><h1 style="font-size:23px;margin:0 0 18px">'+escapeZohoHtml(spec.title)+'</h1>'
    +'<p style="line-height:1.6">Hi '+escapeZohoHtml(name)+',</p>'
    +'<p style="line-height:1.65">'+escapeZohoHtml(spec.message)+'</p>'
    +'<p style="line-height:1.6">Order reference: <strong>'+escapeZohoHtml(reference)+'</strong></p>'
    +codNote
    +'<a href="'+escapeZohoHtml(orderUrl)+'" style="display:inline-block;background:#5b35e5;color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold">View order details</a>'
    +'<p style="font-size:12px;color:#667085;margin-top:25px">To view this order, sign in to the same customer account used at checkout. We never ask for OTPs, passwords, or payment PINs by email.</p>'
    +'</div></main></body></html>';
  return {subject,html,templateEvent:eventType};
}

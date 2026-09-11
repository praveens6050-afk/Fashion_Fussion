const crypto = require('crypto');
const {
  WEBHOOK_SECRET,
  SUPABASE_URL,
  serverHeaders,
  json,
  readRawBody,
  safeEqualText,
  roundMoney
} = require('../lib');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Store database request failed');
  return data;
}

async function rpc(name, args) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { ...serverHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Could not finalize checkout');
  return data;
}

async function loadOrderByRazorpayOrder(razorpayOrderId) {
  const rows = await rest(
    'orders?razorpay_order_id=eq.' + encodeURIComponent(razorpayOrderId) +
    '&select=id,user_id,total_amount,status,payment_method,razorpay_payment_id&limit=1'
  );
  return rows?.[0] || null;
}

async function loadOrderByPayment(paymentId) {
  const rows = await rest(
    'orders?razorpay_payment_id=eq.' + encodeURIComponent(paymentId) +
    '&select=id,user_id,total_amount,status,payment_method,fulfillment_status,items,coupon_discount,gift_card_discount,razorpay_payment_id&limit=1'
  );
  return rows?.[0] || null;
}

function expectedRefundAmount(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = roundMoney(items.reduce((sum, item) => {
    const value = item?.taxable_amount ?? (Number(item?.unit_price || 0) * Number(item?.qty || 1));
    return sum + Number(value || 0);
  }, 0));
  const gst = roundMoney(items.reduce((sum, item) => sum + Number(item?.gst_amount || 0), 0));
  const coupon = roundMoney(order.coupon_discount || 0);
  const gift = roundMoney(order.gift_card_discount || 0);
  const total = roundMoney(order.total_amount || 0);
  const delivery = roundMoney(Math.max(0, total - subtotal - gst + coupon + gift));
  return roundMoney(Math.max(0, total - delivery));
}

async function updateRefundStatus(order, nextStatus) {
  const allowed = nextStatus === 'refunded'
    ? 'in.(refund_initiated,refund_pending,refunded)'
    : 'in.(refund_initiated,refund_pending,refund_failed)';
  const updated = await rest(
    'orders?id=eq.' + encodeURIComponent(order.id) + '&status=' + allowed,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: nextStatus })
    }
  );
  return updated?.[0] || null;
}

async function handlePaymentCaptured(event) {
  const payment = event?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id || payment.status !== 'captured') {
    return { received: true, ignored: true };
  }

  const order = await loadOrderByRazorpayOrder(payment.order_id);
  if (!order || order.payment_method !== 'prepaid') {
    return { received: true, ignored: true };
  }
  if (Math.round(Number(order.total_amount) * 100) !== Number(payment.amount)) {
    console.error('Webhook amount mismatch for store order', order.id);
    const error = new Error('Payment amount mismatch');
    error.status = 409;
    throw error;
  }
  if (order.status === 'paid') {
    return { received: true, already_processed: true };
  }

  await rpc('finalize_checkout_order', {
    p_order_id: order.id,
    p_user_id: order.user_id,
    p_payment_id: String(payment.id),
    p_payment_signature: null,
    p_target_status: 'paid',
    p_source: 'razorpay_webhook'
  });

  return { received: true, finalized: true, store_order_id: order.id };
}

async function handleRefundEvent(event) {
  const refund = event?.payload?.refund?.entity;
  if (!refund?.id || !refund?.payment_id) return { received: true, ignored: true };

  const order = await loadOrderByPayment(refund.payment_id);
  if (!order || order.payment_method !== 'prepaid') return { received: true, ignored: true };

  const expectedPaise = Math.round(expectedRefundAmount(order) * 100);
  if (Number(refund.amount) !== expectedPaise) {
    console.error('Refund amount mismatch for store order', order.id, refund.id);
    return { received: true, ignored: true, reason: 'refund_amount_mismatch' };
  }

  if (event.event === 'refund.processed') {
    if (order.status === 'refunded') return { received: true, already_processed: true };
    const updated = await updateRefundStatus(order, 'refunded');
    if (!updated) return { received: true, ignored: true, reason: 'order_not_waiting_for_refund' };
    return { received: true, refund_processed: true, store_order_id: order.id };
  }

  if (event.event === 'refund.failed') {
    const updated = await updateRefundStatus(order, 'refund_failed');
    if (!updated) return { received: true, ignored: true, reason: 'order_not_waiting_for_refund' };
    return { received: true, refund_failed: true, store_order_id: order.id };
  }

  return { received: true, ignored: true };
}

module.exports = async function razorpayWebhook(req, res) {
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });
  if (!WEBHOOK_SECRET) {
    return json(req, res, 503, { error: 'Razorpay webhook secret is not configured' });
  }

  try {
    const raw = await readRawBody(req);
    const received = String(req.headers['x-razorpay-signature'] || '');
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (!received || !safeEqualText(expected, received)) {
      return json(req, res, 401, { error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(raw.toString('utf8') || '{}');
    let result;
    if (event.event === 'payment.captured') result = await handlePaymentCaptured(event);
    else if (event.event === 'refund.processed' || event.event === 'refund.failed') result = await handleRefundEvent(event);
    else result = { received: true, ignored: true };

    return json(req, res, 200, result);
  } catch (error) {
    console.error('razorpay-webhook error:', error);
    return json(req, res, error.status || 500, { error: error.message || 'Webhook processing failed' });
  }
};

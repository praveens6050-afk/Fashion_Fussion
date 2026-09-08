const crypto = require('crypto');
const {
  WEBHOOK_SECRET,
  SUPABASE_URL,
  serverHeaders,
  json,
  readRawBody,
  safeEqualText
} = require('../lib');

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

async function loadOrder(razorpayOrderId) {
  const response = await fetch(
    SUPABASE_URL + '/rest/v1/orders?razorpay_order_id=eq.' + encodeURIComponent(razorpayOrderId) +
    '&select=id,user_id,total_amount,status,payment_method,razorpay_payment_id&limit=1',
    { headers: serverHeaders }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error('Could not load store order');
  return rows?.[0] || null;
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
    if (event.event !== 'payment.captured') {
      return json(req, res, 200, { received: true, ignored: true });
    }

    const payment = event?.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id || payment.status !== 'captured') {
      return json(req, res, 200, { received: true, ignored: true });
    }

    const order = await loadOrder(payment.order_id);
    if (!order || order.payment_method !== 'prepaid') {
      return json(req, res, 200, { received: true, ignored: true });
    }
    if (Math.round(Number(order.total_amount) * 100) !== Number(payment.amount)) {
      console.error('Webhook amount mismatch for store order', order.id);
      return json(req, res, 409, { error: 'Payment amount mismatch' });
    }
    if (order.status === 'paid') {
      return json(req, res, 200, { received: true, already_processed: true });
    }

    await rpc('finalize_checkout_order', {
      p_order_id: order.id,
      p_user_id: order.user_id,
      p_payment_id: String(payment.id),
      p_payment_signature: null,
      p_target_status: 'paid',
      p_source: 'razorpay_webhook'
    });

    return json(req, res, 200, { received: true, finalized: true, store_order_id: order.id });
  } catch (error) {
    console.error('razorpay-webhook error:', error);
    return json(req, res, 500, { error: 'Webhook processing failed' });
  }
};

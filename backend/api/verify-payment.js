const crypto = require('crypto');
const {
  KEY_SECRET,
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser,
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

async function loadStoreOrder(razorpayOrderId) {
  const response = await fetch(
    SUPABASE_URL + '/rest/v1/orders?razorpay_order_id=eq.' + encodeURIComponent(razorpayOrderId) +
    '&select=id,user_id,total_amount,status,payment_method,razorpay_payment_id,display_order_id&limit=1',
    { headers: serverHeaders }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error('Could not load store order');
  return rows?.[0] || null;
}

module.exports = async function verifyPayment(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });
  if (!KEY_SECRET) return json(req, res, 500, { verified: false, error: 'Razorpay server key is not configured' });

  try {
    const user = await getSupabaseUser(req);
    const body = await readBody(req);
    const {
      order_id,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = body;

    if (!order_id || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return json(req, res, 400, { verified: false, error: 'Missing payment fields' });
    }
    if (String(order_id) !== String(razorpay_order_id)) {
      return json(req, res, 400, { verified: false, error: 'Order ID mismatch' });
    }

    const expected = crypto
      .createHmac('sha256', KEY_SECRET)
      .update(String(order_id) + '|' + String(razorpay_payment_id))
      .digest('hex');

    if (!safeEqualText(expected, razorpay_signature)) {
      return json(req, res, 400, { verified: false, error: 'Invalid payment signature' });
    }

    const paymentResponse = await fetch(
      'https://api.razorpay.com/v1/payments/' + encodeURIComponent(razorpay_payment_id),
      { headers: { Authorization: basicAuth() } }
    );
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) {
      return json(req, res, 502, { verified: false, error: 'Could not verify payment status' });
    }
    if (String(payment.order_id) !== String(order_id)) {
      return json(req, res, 400, { verified: false, error: 'Payment/order mismatch' });
    }
    if (payment.status !== 'captured') {
      return json(req, res, 400, { verified: false, error: 'Payment is not captured yet' });
    }

    const order = await loadStoreOrder(order_id);
    if (!order) return json(req, res, 404, { verified: false, error: 'Store order was not found' });
    if (order.user_id !== user.id) {
      return json(req, res, 403, { verified: false, error: 'This order does not belong to the current user' });
    }
    if (order.payment_method !== 'prepaid') {
      return json(req, res, 400, { verified: false, error: 'This is not a prepaid order' });
    }
    if (Math.round(Number(order.total_amount) * 100) !== Number(payment.amount)) {
      return json(req, res, 400, { verified: false, error: 'Payment amount does not match order amount' });
    }

    if (order.status === 'paid') {
      if (order.razorpay_payment_id && order.razorpay_payment_id !== razorpay_payment_id) {
        return json(req, res, 409, { verified: false, error: 'Order is already linked to a different payment' });
      }
      return json(req, res, 200, {
        verified: true,
        already_processed: true,
        payment_id: razorpay_payment_id,
        order_id,
        store_order_id: order.id,
        display_order_id: order.display_order_id,
        status: 'paid'
      });
    }

    try {
      await rpc('finalize_checkout_order', {
        p_order_id: order.id,
        p_user_id: user.id,
        p_payment_id: String(razorpay_payment_id),
        p_payment_signature: String(razorpay_signature),
        p_target_status: 'paid',
        p_source: 'browser_verify'
      });
    } catch (error) {
      console.error('Atomic checkout finalize failed:', error);
      return json(req, res, 409, {
        verified: false,
        captured: true,
        recoverable: true,
        error: 'Payment is captured. Your order is safe and will be reconciled automatically; please do not pay again.',
        store_order_id: order.id,
        display_order_id: order.display_order_id
      });
    }

    return json(req, res, 200, {
      verified: true,
      payment_id: razorpay_payment_id,
      order_id,
      store_order_id: order.id,
      display_order_id: order.display_order_id,
      status: 'paid'
    });
  } catch (error) {
    console.error('verify-payment error:', error);
    return json(req, res, 400, {
      verified: false,
      error: error.message || 'Payment verification failed'
    });
  }
};

const {
  KEY_ID,
  KEY_SECRET,
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser
} = require('../lib');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error('Could not load this payment.');
  return data;
}

async function loadOrder(userId, orderId) {
  const rows = await rest(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&user_id=eq.' + encodeURIComponent(userId) +
    '&select=id,display_order_id,total_amount,currency,status,payment_method,payment_verified_at,razorpay_order_id,customer_name,customer_email,customer_phone&limit=1'
  );
  return rows?.[0] || null;
}

async function loadRazorpayOrder(orderId) {
  const response = await fetch(
    'https://api.razorpay.com/v1/orders/' + encodeURIComponent(orderId),
    { headers: { Authorization: basicAuth() } }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error('Online payment is temporarily unavailable. Please try again.');
  return data;
}

module.exports = async function resumePayment(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });

  try {
    const user = await getSupabaseUser(req);
    const body = await readBody(req);
    const storeOrderId = String(body.store_order_id || '').trim();
    if (!/^\d+$/.test(storeOrderId)) return json(req, res, 400, { error: 'Invalid order.' });

    const order = await loadOrder(user.id, storeOrderId);
    if (!order) return json(req, res, 404, { error: 'Order not found.' });
    if (String(order.payment_method || '').toLowerCase() !== 'prepaid') {
      return json(req, res, 400, { error: 'This order does not need an online payment.' });
    }

    const status = String(order.status || '').toLowerCase();
    if (order.payment_verified_at || status === 'paid') {
      return json(req, res, 200, {
        completed: true,
        status: 'paid',
        store_order_id: order.id,
        display_order_id: order.display_order_id
      });
    }

    if (['payment_failed', 'expired', 'cancelled', 'refund_initiated', 'refund_pending', 'refund_failed', 'refunded'].includes(status)) {
      return json(req, res, 409, {
        error: 'This payment session is no longer active. Return to your cart to start a new checkout.',
        restart_checkout: true,
        store_order_id: order.id,
        display_order_id: order.display_order_id
      });
    }

    if (!['creating', 'created', 'pending', 'payment_pending'].includes(status)) {
      return json(req, res, 409, { error: 'This order is not waiting for an online payment.' });
    }
    if (!order.razorpay_order_id) {
      return json(req, res, 409, {
        error: 'The payment session is still being prepared. Please wait a moment and try again.',
        recoverable: true
      });
    }
    if (!KEY_ID || !KEY_SECRET) {
      return json(req, res, 503, { error: 'Online payment is temporarily unavailable. Please try again later.' });
    }

    const gatewayOrder = await loadRazorpayOrder(order.razorpay_order_id);
    const expectedAmount = Math.round(Number(order.total_amount) * 100);
    if (String(gatewayOrder.id) !== String(order.razorpay_order_id) || Number(gatewayOrder.amount) !== expectedAmount) {
      return json(req, res, 409, { error: 'Payment details could not be confirmed. Please contact Customer Care.' });
    }
    if (String(gatewayOrder.status || '').toLowerCase() === 'paid') {
      return json(req, res, 202, {
        captured: true,
        recoverable: true,
        store_order_id: order.id,
        display_order_id: order.display_order_id,
        message: 'Payment has been received and is being confirmed. Please do not pay again.'
      });
    }

    return json(req, res, 200, {
      completed: false,
      status: status || 'created',
      key_id: KEY_ID,
      store_order_id: order.id,
      display_order_id: order.display_order_id,
      order: {
        id: gatewayOrder.id,
        amount: Number(gatewayOrder.amount),
        currency: gatewayOrder.currency || order.currency || 'INR'
      },
      customer: {
        name: order.customer_name || '',
        email: order.customer_email || user.email || '',
        phone: order.customer_phone || ''
      }
    });
  } catch (error) {
    console.error('resume-payment error:', error);
    return json(req, res, 400, { error: error.message || 'Unable to resume payment.' });
  }
};

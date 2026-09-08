const {
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser
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

async function loadOrder(userId, storeOrderId) {
  const response = await fetch(
    SUPABASE_URL + '/rest/v1/orders?id=eq.' + encodeURIComponent(storeOrderId) +
    '&user_id=eq.' + encodeURIComponent(userId) +
    '&select=id,user_id,display_order_id,total_amount,status,payment_method,razorpay_order_id,razorpay_payment_id&limit=1',
    { headers: serverHeaders }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error('Could not load order');
  return rows?.[0] || null;
}

module.exports = async function reconcilePayment(req, res) {
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
    if (!/^\d+$/.test(storeOrderId)) {
      return json(req, res, 400, { reconciled: false, error: 'Invalid store order ID' });
    }

    const order = await loadOrder(user.id, storeOrderId);
    if (!order) return json(req, res, 404, { reconciled: false, error: 'Order not found' });
    if (order.payment_method !== 'prepaid') {
      return json(req, res, 200, { reconciled: false, status: order.status, store_order_id: order.id });
    }
    if (order.status === 'paid') {
      return json(req, res, 200, {
        reconciled: true,
        already_processed: true,
        status: 'paid',
        store_order_id: order.id,
        display_order_id: order.display_order_id
      });
    }
    if (!order.razorpay_order_id) {
      return json(req, res, 200, { reconciled: false, status: order.status, store_order_id: order.id });
    }

    const paymentsResponse = await fetch(
      'https://api.razorpay.com/v1/orders/' + encodeURIComponent(order.razorpay_order_id) + '/payments',
      { headers: { Authorization: basicAuth() } }
    );
    const paymentsData = await paymentsResponse.json().catch(() => ({}));
    if (!paymentsResponse.ok) {
      return json(req, res, 502, { reconciled: false, error: 'Could not check payment status' });
    }

    const captured = (paymentsData.items || []).find(payment =>
      payment.status === 'captured' &&
      String(payment.order_id) === String(order.razorpay_order_id) &&
      Number(payment.amount) === Math.round(Number(order.total_amount) * 100)
    );

    if (!captured) {
      return json(req, res, 200, { reconciled: false, status: order.status, store_order_id: order.id });
    }

    await rpc('finalize_checkout_order', {
      p_order_id: order.id,
      p_user_id: user.id,
      p_payment_id: String(captured.id),
      p_payment_signature: null,
      p_target_status: 'paid',
      p_source: 'authenticated_reconcile'
    });

    return json(req, res, 200, {
      reconciled: true,
      payment_id: captured.id,
      status: 'paid',
      store_order_id: order.id,
      display_order_id: order.display_order_id
    });
  } catch (error) {
    console.error('reconcile-payment error:', error);
    return json(req, res, 400, { reconciled: false, error: error.message || 'Payment reconciliation failed' });
  }
};

const crypto = require('crypto');
const {
  KEY_SECRET, SUPABASE_URL, serverHeaders, cors, json, readBody,
  basicAuth, getSupabaseUser, safeEqualText
} = require('../lib');

const ACTIVE_CHECKOUT_STATUSES = new Set(['creating', 'created']);
function isInactiveCheckoutStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return !ACTIVE_CHECKOUT_STATUSES.has(normalized) && normalized !== 'paid';
}
async function rpc(name, args) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { ...serverHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(args)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Could not finalize checkout');
  return data;
}
async function recordPaymentException(order, type, paymentId, details = {}) {
  await rpc('record_payment_exception', {
    p_order_id: order.id, p_user_id: order.user_id, p_exception_type: type,
    p_source: 'verify_payment', p_payment_id: paymentId ? String(paymentId) : null,
    p_order_status: order.status || null, p_details: details
  });
}
async function loadStoreOrder(razorpayOrderId) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/orders?razorpay_order_id=eq.' + encodeURIComponent(razorpayOrderId) + '&select=id,user_id,total_amount,status,payment_method,razorpay_payment_id,display_order_id&limit=1', { headers: serverHeaders });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error('Could not load store order');
  return rows?.[0] || null;
}
async function commitInventory(orderId) { await rpc('commit_order_inventory', { p_order_id: orderId }); }
async function queueReviewOrRespond(req, res, order, type, paymentId, details) {
  try {
    await recordPaymentException(order, type, paymentId, details);
    return false;
  } catch (error) {
    console.error('Could not durably queue payment review', { store_order_id: order.id, type, error: error.message });
    json(req, res, 503, {
      verified: false, captured: true, manual_review: true, review_queued: false, recoverable: true,
      error: 'Payment is captured, but support review could not be queued yet. Please do not pay again; retry this status check or contact support.',
      store_order_id: order.id, display_order_id: order.display_order_id, status: order.status
    });
    return true;
  }
}

module.exports = async function verifyPayment(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });
  if (!KEY_SECRET) return json(req, res, 500, { verified: false, error: 'Razorpay server key is not configured' });
  try {
    const user = await getSupabaseUser(req);
    const body = await readBody(req);
    const { order_id, razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;
    if (!order_id || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) return json(req, res, 400, { verified: false, error: 'Missing payment fields' });
    if (String(order_id) !== String(razorpay_order_id)) return json(req, res, 400, { verified: false, error: 'Order ID mismatch' });
    const expected = crypto.createHmac('sha256', KEY_SECRET).update(String(order_id) + '|' + String(razorpay_payment_id)).digest('hex');
    if (!safeEqualText(expected, razorpay_signature)) return json(req, res, 400, { verified: false, error: 'Invalid payment signature' });
    const paymentResponse = await fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(razorpay_payment_id), { headers: { Authorization: basicAuth() } });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) return json(req, res, 502, { verified: false, error: 'Could not verify payment status' });
    if (String(payment.order_id) !== String(order_id)) return json(req, res, 400, { verified: false, error: 'Payment/order mismatch' });
    if (payment.status !== 'captured') return json(req, res, 400, { verified: false, error: 'Payment is not captured yet' });
    const order = await loadStoreOrder(order_id);
    if (!order) return json(req, res, 404, { verified: false, error: 'Store order was not found' });
    if (order.user_id !== user.id) return json(req, res, 403, { verified: false, error: 'This order does not belong to the current user' });
    if (order.payment_method !== 'prepaid') return json(req, res, 400, { verified: false, error: 'This is not a prepaid order' });
    if (Math.round(Number(order.total_amount) * 100) !== Number(payment.amount)) return json(req, res, 400, { verified: false, error: 'Payment amount does not match order amount' });

    if (order.razorpay_payment_id && String(order.razorpay_payment_id) !== String(razorpay_payment_id)) {
      if (await queueReviewOrRespond(req, res, order, 'different_payment_reference', razorpay_payment_id, { existing_payment_id: String(order.razorpay_payment_id), razorpay_order_id: String(order_id) })) return;
      return json(req, res, 409, { verified: false, captured: true, manual_review: true, review_queued: true, error: 'This order is already linked to a different captured payment. Support review is required; please do not pay again.', store_order_id: order.id, display_order_id: order.display_order_id, status: order.status });
    }
    if (order.status === 'paid') {
      try { await commitInventory(order.id); }
      catch (error) { console.error('Inventory commit repair failed:', error); return json(req, res, 409, { verified: false, captured: true, recoverable: true, error: 'Payment is captured. Inventory finalization is being reconciled; please do not pay again.', store_order_id: order.id, display_order_id: order.display_order_id }); }
      return json(req, res, 200, { verified: true, already_processed: true, order_id, store_order_id: order.id, display_order_id: order.display_order_id, status: 'paid' });
    }
    if (isInactiveCheckoutStatus(order.status)) {
      console.error('Captured payment requires manual review for inactive order', { store_order_id: order.id, status: order.status });
      if (await queueReviewOrRespond(req, res, order, 'inactive_order_capture', razorpay_payment_id, { razorpay_order_id: String(order_id) })) return;
      return json(req, res, 409, { verified: false, captured: true, manual_review: true, review_queued: true, error: 'Payment is captured, but this order is no longer in an active checkout state. Support review is required; please do not pay again.', store_order_id: order.id, display_order_id: order.display_order_id, status: order.status });
    }
    try {
      await rpc('finalize_checkout_order', { p_order_id: order.id, p_user_id: user.id, p_payment_id: String(razorpay_payment_id), p_payment_signature: String(razorpay_signature), p_target_status: 'paid', p_source: 'browser_verify' });
      await commitInventory(order.id);
    } catch (error) {
      console.error('Atomic checkout/inventory finalize failed:', error);
      return json(req, res, 409, { verified: false, captured: true, recoverable: true, error: 'Payment is captured. Finalization is pending reconciliation; please do not pay again.', store_order_id: order.id, display_order_id: order.display_order_id });
    }
    return json(req, res, 200, { verified: true, order_id, store_order_id: order.id, display_order_id: order.display_order_id, status: 'paid' });
  } catch (error) {
    console.error('verify-payment error:', error);
    return json(req, res, 400, { verified: false, error: error.message || 'Payment verification failed' });
  }
};

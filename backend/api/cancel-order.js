const {
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  getSupabaseUser
} = require('../lib');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Order cancellation failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function cleanReason(value) {
  const reason = String(value || '').trim();
  if (!reason) throw new Error('Please select a cancellation reason');
  if (reason.length > 180) throw new Error('Cancellation reason is too long');
  return reason;
}

module.exports = async function cancelOrder(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });

  try {
    const user = await getSupabaseUser(req);
    const body = await readBody(req);
    const orderId = Number(body.order_id);
    const reason = cleanReason(body.reason);

    if (!Number.isInteger(orderId) || orderId < 1) {
      return json(req, res, 400, { error: 'Invalid order ID' });
    }

    const rows = await rest(
      'orders?id=eq.' + encodeURIComponent(orderId) +
      '&user_id=eq.' + encodeURIComponent(user.id) +
      '&select=id,display_order_id,status,payment_method,fulfillment_status,total_amount,items&limit=1'
    );
    const order = rows?.[0];
    if (!order) return json(req, res, 404, { error: 'Order not found' });

    const status = String(order.status || '').toLowerCase();
    const fulfillment = String(order.fulfillment_status || 'ordered').toLowerCase();
    const terminal = ['cancelled', 'cod_cancelled', 'refunded', 'payment_failed', 'expired'];

    if (terminal.includes(status) || fulfillment === 'cancelled') {
      return json(req, res, 409, { error: 'This order is already closed' });
    }
    if (!['ordered', 'packed'].includes(fulfillment)) {
      return json(req, res, 409, { error: 'This order can no longer be cancelled because fulfilment has progressed' });
    }

    // Prepaid cancellation requires a gateway refund. Keep it blocked until the
    // Razorpay refund path and refund ledger are enabled so money cannot be lost.
    if (String(order.payment_method || '').toLowerCase() !== 'cod') {
      return json(req, res, 409, {
        error: 'Prepaid cancellation needs refund processing and is not enabled yet',
        code: 'REFUND_REQUIRED'
      });
    }

    if (status !== 'cod_pending') {
      return json(req, res, 409, { error: 'This COD order is not in a cancellable payment state' });
    }

    const updated = await rest(
      'orders?id=eq.' + encodeURIComponent(orderId) +
      '&user_id=eq.' + encodeURIComponent(user.id) +
      '&status=eq.cod_pending&fulfillment_status=in.(ordered,packed)',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'cod_cancelled',
          fulfillment_status: 'cancelled',
          fulfillment_updated_at: new Date().toISOString()
        })
      }
    );

    if (!updated?.length) {
      return json(req, res, 409, { error: 'Order status changed before cancellation. Please refresh and try again.' });
    }

    return json(req, res, 200, {
      ok: true,
      order_id: orderId,
      display_order_id: order.display_order_id,
      status: 'cod_cancelled',
      fulfillment_status: 'cancelled',
      reason,
      refund: {
        required: false,
        amount: 0,
        destination: null,
        message: 'No refund is required because payment was not collected for this COD order.'
      }
    });
  } catch (error) {
    console.error('cancel-order error:', error);
    return json(req, res, error.status || 400, { error: error.message || 'Unable to cancel order' });
  }
};

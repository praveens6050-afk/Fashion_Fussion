const {
  KEY_ID,
  KEY_SECRET,
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser,
  roundMoney
} = require('../lib');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Refund reconciliation failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function pricing(order) {
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
  const refundable = roundMoney(Math.max(0, total - delivery));
  return { delivery, refundable };
}

function refundReference(refund) {
  return refund?.acquirer_data?.arn || refund?.acquirer_data?.rrn || refund?.acquirer_data?.utr || null;
}

async function loadOrder(userId, orderId) {
  const rows = await rest(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&user_id=eq.' + encodeURIComponent(userId) +
    '&select=id,display_order_id,user_id,status,payment_method,fulfillment_status,total_amount,items,coupon_discount,gift_card_discount,razorpay_payment_id,refund_id,refund_status,refund_reference,refund_amount,refund_updated_at&limit=1'
  );
  return rows?.[0] || null;
}

async function fetchRefunds(paymentId) {
  if (!KEY_ID || !KEY_SECRET) {
    const error = new Error('Refund service is not configured');
    error.status = 503;
    throw error;
  }
  const response = await fetch(
    'https://api.razorpay.com/v1/payments/' + encodeURIComponent(paymentId) + '/refunds?count=100',
    { headers: { Authorization: basicAuth() } }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.description || 'Could not check refund status');
    error.status = 502;
    throw error;
  }
  return Array.isArray(data.items) ? data.items : [];
}

function findStoreRefund(refunds, order, expectedPaise) {
  const receipt = 'FF_CANCEL_' + String(order.id);
  return refunds
    .filter(refund =>
      String(refund?.payment_id || '') === String(order.razorpay_payment_id || '') &&
      Number(refund?.amount) === expectedPaise &&
      (
        String(refund?.id || '') === String(order.refund_id || '') ||
        String(refund?.receipt || '') === receipt ||
        String(refund?.notes?.store_order_id || '') === String(order.id)
      )
    )
    .sort((a, b) => Number(b?.created_at || 0) - Number(a?.created_at || 0))[0] || null;
}

async function reconcileOrder(order, refund) {
  const refundStatus = String(refund?.status || '').toLowerCase();
  let nextStatus = null;
  if (refundStatus === 'processed') nextStatus = 'refunded';
  else if (refundStatus === 'failed') nextStatus = 'refund_failed';
  else if (refundStatus === 'pending') nextStatus = 'refund_pending';
  if (!nextStatus) return order.status;

  const allowedCurrent = ['paid', 'refund_pending', 'refund_initiated', 'refund_failed', 'refunded'];
  if (!allowedCurrent.includes(String(order.status || '').toLowerCase())) return order.status;

  const now = new Date().toISOString();
  const updated = await rest(
    'orders?id=eq.' + encodeURIComponent(order.id) +
    '&user_id=eq.' + encodeURIComponent(order.user_id) +
    '&status=in.(' + allowedCurrent.join(',') + ')',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        status: nextStatus,
        fulfillment_status: 'cancelled',
        fulfillment_updated_at: now,
        refund_id: refund.id || order.refund_id || null,
        refund_status: refund.status || null,
        refund_reference: refundReference(refund) || order.refund_reference || null,
        refund_amount: roundMoney(Number(refund.amount || 0) / 100),
        refund_updated_at: now
      })
    }
  );
  return updated?.[0]?.status || order.status;
}

module.exports = async function refundStatus(req, res) {
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
    if (!Number.isInteger(orderId) || orderId < 1) {
      return json(req, res, 400, { error: 'Invalid order ID' });
    }

    const order = await loadOrder(user.id, orderId);
    if (!order) return json(req, res, 404, { error: 'Order not found' });
    if (order.payment_method !== 'prepaid') {
      return json(req, res, 200, {
        reconciled: false,
        status: order.status,
        message: 'This order does not use a prepaid payment method.'
      });
    }
    if (!order.razorpay_payment_id) {
      return json(req, res, 200, {
        reconciled: false,
        status: order.status,
        message: 'No Razorpay payment reference is available for this order.'
      });
    }

    const breakdown = pricing(order);
    const expectedPaise = Math.round(breakdown.refundable * 100);
    const refunds = await fetchRefunds(order.razorpay_payment_id);
    const refund = findStoreRefund(refunds, order, expectedPaise);

    if (!refund) {
      return json(req, res, 200, {
        reconciled: false,
        status: order.status,
        refund: order.refund_id ? {
          id: order.refund_id,
          status: order.refund_status || null,
          amount: order.refund_amount == null ? null : roundMoney(order.refund_amount),
          destination: 'original_payment_method',
          reference: order.refund_reference || null,
          updated_at: order.refund_updated_at || null
        } : null,
        refundable_amount: breakdown.refundable,
        non_refundable_delivery: breakdown.delivery
      });
    }

    const reconciledStatus = await reconcileOrder(order, refund);
    return json(req, res, 200, {
      reconciled: true,
      status: reconciledStatus,
      order_id: order.id,
      display_order_id: order.display_order_id,
      refund: {
        id: refund.id,
        status: refund.status || null,
        amount: roundMoney(Number(refund.amount || 0) / 100),
        destination: 'original_payment_method',
        reference: refundReference(refund) || order.refund_reference || null,
        created_at: refund.created_at || null,
        speed: refund.speed_processed || refund.speed_requested || null
      },
      refundable_amount: breakdown.refundable,
      non_refundable_delivery: breakdown.delivery
    });
  } catch (error) {
    console.error('refund-status error:', error);
    return json(req, res, error.status || 400, { error: error.message || 'Unable to reconcile refund' });
  }
};

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
  return { subtotal, gst, coupon, gift, delivery, total, refundable };
}

async function createRazorpayRefund(order, amount) {
  if (!KEY_ID || !KEY_SECRET) {
    const error = new Error('Refund service is not configured');
    error.status = 503;
    throw error;
  }
  if (!order.razorpay_payment_id) {
    const error = new Error('Payment reference is missing for this order');
    error.status = 409;
    throw error;
  }

  const amountPaise = Math.round(Number(amount) * 100);
  const idempotencyKey = 'ff_cancel_' + String(order.id) + '_refund';
  const payload = {
    amount: amountPaise,
    speed: 'normal',
    receipt: 'FF_CANCEL_' + String(order.id),
    notes: { store_order_id: String(order.id), source: 'customer_cancellation' }
  };

  const response = await fetch(
    'https://api.razorpay.com/v1/payments/' + encodeURIComponent(order.razorpay_payment_id) + '/refund',
    {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/json',
        'X-Refund-Idempotency': idempotencyKey
      },
      body: JSON.stringify(payload)
    }
  );
  const refund = await response.json().catch(() => ({}));
  if (!response.ok || !refund?.id) {
    const error = new Error(refund?.error?.description || 'Refund could not be initiated');
    error.status = response.status === 409 ? 409 : 502;
    throw error;
  }
  return refund;
}

async function patchCancelledOrder(order, nextStatus) {
  const expected = String(order.status || '').toLowerCase();
  const updated = await rest(
    'orders?id=eq.' + encodeURIComponent(order.id) +
    '&user_id=eq.' + encodeURIComponent(order.user_id) +
    '&status=eq.' + encodeURIComponent(expected) +
    '&fulfillment_status=in.(ordered,packed)',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        status: nextStatus,
        fulfillment_status: 'cancelled',
        fulfillment_updated_at: new Date().toISOString()
      })
    }
  );
  if (!updated?.length) {
    const error = new Error('Order status changed before cancellation. Please refresh and try again.');
    error.status = 409;
    throw error;
  }
  return updated[0];
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
      '&select=id,display_order_id,user_id,status,payment_method,fulfillment_status,total_amount,items,coupon_discount,gift_card_discount,razorpay_payment_id&limit=1'
    );
    const order = rows?.[0];
    if (!order) return json(req, res, 404, { error: 'Order not found' });

    const status = String(order.status || '').toLowerCase();
    const paymentMethod = String(order.payment_method || '').toLowerCase();
    const fulfillment = String(order.fulfillment_status || 'ordered').toLowerCase();
    const terminal = ['cancelled', 'cod_cancelled', 'refunded', 'payment_failed', 'expired'];

    if (terminal.includes(status) || fulfillment === 'cancelled') {
      return json(req, res, 409, { error: 'This order is already closed' });
    }
    if (!['ordered', 'packed'].includes(fulfillment)) {
      return json(req, res, 409, { error: 'This order can no longer be cancelled because fulfilment has progressed' });
    }

    const breakdown = pricing(order);

    if (paymentMethod === 'cod') {
      if (status !== 'cod_pending') {
        return json(req, res, 409, { error: 'This COD order is not in a cancellable payment state' });
      }
      await patchCancelledOrder(order, 'cod_cancelled');
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
          delivery_non_refundable: breakdown.delivery,
          destination: null,
          message: 'No refund is required because payment was not collected for this COD order.'
        }
      });
    }

    if (paymentMethod !== 'prepaid' || status !== 'paid') {
      return json(req, res, 409, { error: 'This prepaid order is not in a cancellable payment state' });
    }

    if (breakdown.gift > 0) {
      return json(req, res, 409, {
        error: 'Orders paid partly with a gift card need support-assisted cancellation so the gift-card balance can be restored safely.',
        code: 'GIFT_CARD_RESTORE_REQUIRED'
      });
    }

    if (breakdown.refundable <= 0) {
      await patchCancelledOrder(order, 'cancelled');
      return json(req, res, 200, {
        ok: true,
        order_id: orderId,
        display_order_id: order.display_order_id,
        status: 'cancelled',
        fulfillment_status: 'cancelled',
        reason,
        refund: {
          required: false,
          amount: 0,
          delivery_non_refundable: breakdown.delivery,
          destination: 'original_payment_method',
          message: 'There is no refundable payment amount after the non-refundable delivery charge.'
        }
      });
    }

    const refund = await createRazorpayRefund(order, breakdown.refundable);
    const processed = String(refund.status || '').toLowerCase() === 'processed';
    const nextStatus = processed ? 'refunded' : 'refund_initiated';
    await patchCancelledOrder(order, nextStatus);

    return json(req, res, 200, {
      ok: true,
      order_id: orderId,
      display_order_id: order.display_order_id,
      status: nextStatus,
      fulfillment_status: 'cancelled',
      reason,
      refund: {
        required: true,
        id: refund.id,
        status: refund.status || 'pending',
        amount: roundMoney(Number(refund.amount || 0) / 100),
        delivery_non_refundable: breakdown.delivery,
        destination: 'original_payment_method',
        reference: refund?.acquirer_data?.arn || refund?.acquirer_data?.rrn || refund?.acquirer_data?.utr || null,
        speed: refund.speed_processed || refund.speed_requested || 'normal',
        message: processed
          ? 'Refund processed to the original payment method.'
          : 'Refund initiated to the original payment method.'
      }
    });
  } catch (error) {
    console.error('cancel-order error:', error);
    return json(req, res, error.status || 400, { error: error.message || 'Unable to cancel order' });
  }
};

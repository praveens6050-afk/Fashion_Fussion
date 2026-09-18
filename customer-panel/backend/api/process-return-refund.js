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
    const error = new Error(data?.message || data?.error || 'Return refund processing failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requireAdmin(req) {
  const user = await getSupabaseUser(req);
  const profiles = await rest('profiles?id=eq.' + encodeURIComponent(user.id) + '&select=is_admin&limit=1');
  if (!profiles?.[0]?.is_admin) {
    const error = new Error('Administrator access required');
    error.status = 403;
    throw error;
  }
  return user;
}

function refundReference(refund) {
  return refund?.acquirer_data?.arn || refund?.acquirer_data?.rrn || refund?.acquirer_data?.utr || null;
}

function itemRefundAmount(order, request) {
  const items = Array.isArray(order.items) ? order.items : [];
  const item = items[Number(request.item_index)];
  if (!item) throw new Error('Order item snapshot is missing');
  const orderedQty = Math.max(1, Number(item.qty ?? item.quantity ?? 1));
  const requestedQty = Number(request.quantity);
  if (!Number.isInteger(requestedQty) || requestedQty < 1 || requestedQty > orderedQty) {
    throw new Error('Return quantity is invalid');
  }
  const taxableTotal = Number(item.taxable_amount ?? (Number(item.unit_price || 0) * orderedQty));
  const gstTotal = Number(item.gst_amount || 0);
  const grossItemTotal = roundMoney(Math.max(0, taxableTotal + gstTotal));
  if (!(grossItemTotal > 0)) throw new Error('Return item refund amount is invalid');
  return roundMoney((grossItemTotal / orderedQty) * requestedQty);
}

async function createRefund(order, request, amount) {
  if (!KEY_ID || !KEY_SECRET) {
    const error = new Error('Refund service is not configured');
    error.status = 503;
    throw error;
  }
  if (!order.razorpay_payment_id) {
    const error = new Error('Original payment reference is missing');
    error.status = 409;
    throw error;
  }
  const response = await fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(order.razorpay_payment_id) + '/refund', {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/json',
      'X-Refund-Idempotency': 'ff_return_' + String(request.id) + '_refund'
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100),
      speed: 'normal',
      receipt: 'FF_RETURN_' + String(request.id),
      notes: {
        store_order_id: String(order.id),
        return_request_id: String(request.id),
        source: 'approved_return_refund'
      }
    })
  });
  const refund = await response.json().catch(() => ({}));
  if (!response.ok || !refund?.id) {
    const error = new Error(refund?.error?.description || 'Refund could not be initiated');
    error.status = response.status === 409 ? 409 : 502;
    throw error;
  }
  return refund;
}

module.exports = async function processReturnRefund(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });
  try {
    await requireAdmin(req);
    const body = await readBody(req);
    const requestId = Number(body.return_request_id);
    if (!Number.isInteger(requestId) || requestId < 1) return json(req, res, 400, { error: 'Invalid return request ID' });

    const requests = await rest('return_requests?id=eq.' + encodeURIComponent(requestId) + '&select=id,user_id,order_id,item_index,request_type,quantity,status,refund_id,refund_status,refund_reference,refund_amount,refund_updated_at&limit=1');
    const request = requests?.[0];
    if (!request) return json(req, res, 404, { error: 'Return request not found' });
    if (request.request_type !== 'return_refund') return json(req, res, 409, { error: 'This request is not a refund return' });
    if (request.refund_id) {
      return json(req, res, 200, { ok: true, already_initiated: true, refund: { id: request.refund_id, status: request.refund_status, amount: request.refund_amount, reference: request.refund_reference } });
    }
    if (!['approved','return_processing'].includes(String(request.status || '').toLowerCase())) {
      return json(req, res, 409, { error: 'Approve the return before initiating its refund' });
    }

    const orders = await rest('orders?id=eq.' + encodeURIComponent(request.order_id) + '&user_id=eq.' + encodeURIComponent(request.user_id) + '&select=id,user_id,status,payment_method,fulfillment_status,items,coupon_discount,gift_card_discount,razorpay_payment_id&limit=1');
    const order = orders?.[0];
    if (!order) return json(req, res, 404, { error: 'Order not found' });
    if (String(order.payment_method || '').toLowerCase() !== 'prepaid') return json(req, res, 409, { error: 'COD return refunds require a verified payout destination and cannot be automated here yet', code: 'COD_PAYOUT_REQUIRED' });
    if (!['paid','refund_initiated','refunded'].includes(String(order.status || '').toLowerCase())) return json(req, res, 409, { error: 'Order payment state is not refundable' });
    if (Number(order.gift_card_discount || 0) > 0 || Number(order.coupon_discount || 0) > 0) {
      return json(req, res, 409, { error: 'Discounted orders require support-assisted refund allocation', code: 'DISCOUNT_ALLOCATION_REQUIRED' });
    }

    const amount = itemRefundAmount(order, request);
    const refund = await createRefund(order, request, amount);
    const now = new Date().toISOString();
    const processed = String(refund.status || '').toLowerCase() === 'processed';
    const updated = await rest('return_requests?id=eq.' + encodeURIComponent(request.id) + '&refund_id=is.null', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        status: processed ? 'completed' : 'return_processing',
        resolved_at: processed ? now : null,
        updated_at: now,
        refund_id: refund.id,
        refund_status: refund.status || 'pending',
        refund_reference: refundReference(refund),
        refund_amount: roundMoney(Number(refund.amount || 0) / 100),
        refund_updated_at: now
      })
    });
    if (!updated?.length) {
      const error = new Error('Return refund state changed while processing. Reconcile the processor refund before retrying.');
      error.status = 409;
      throw error;
    }
    return json(req, res, 200, {
      ok: true,
      return_request_id: request.id,
      status: updated[0].status,
      refund: {
        id: refund.id,
        status: refund.status || 'pending',
        amount: roundMoney(Number(refund.amount || 0) / 100),
        reference: refundReference(refund),
        destination: 'original_payment_method'
      }
    });
  } catch (error) {
    console.error('process-return-refund error:', error);
    return json(req, res, error.status || 400, { error: error.message || 'Unable to process return refund' });
  }
};

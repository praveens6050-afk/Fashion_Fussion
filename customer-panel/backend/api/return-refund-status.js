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
    const error = new Error(data?.message || data?.error || 'Return refund reconciliation failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function refundReference(refund) {
  return refund?.acquirer_data?.arn || refund?.acquirer_data?.rrn || refund?.acquirer_data?.utr || null;
}

async function fetchRefund(refundId) {
  if (!KEY_ID || !KEY_SECRET) {
    const error = new Error('Refund service is not configured');
    error.status = 503;
    throw error;
  }
  const response = await fetch('https://api.razorpay.com/v1/refunds/' + encodeURIComponent(refundId), {
    headers: { Authorization: basicAuth() }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.description || 'Could not check return refund status');
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return data;
}

module.exports = async function returnRefundStatus(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });

  try {
    const user = await getSupabaseUser(req);
    const body = await readBody(req);
    const requestId = Number(body.return_request_id);
    if (!Number.isInteger(requestId) || requestId < 1) {
      return json(req, res, 400, { error: 'Invalid return request ID' });
    }

    const rows = await rest(
      'return_requests?id=eq.' + encodeURIComponent(requestId) +
      '&user_id=eq.' + encodeURIComponent(user.id) +
      '&select=id,user_id,order_id,request_type,status,refund_id,refund_status,refund_reference,refund_amount,refund_updated_at&limit=1'
    );
    const request = rows?.[0];
    if (!request) return json(req, res, 404, { error: 'Return request not found' });
    if (request.request_type !== 'return_refund') {
      return json(req, res, 409, { error: 'This request does not have a payment refund' });
    }
    if (!request.refund_id) {
      return json(req, res, 200, {
        reconciled: false,
        status: request.status,
        refund: null,
        message: 'A refund has not been initiated for this return yet.'
      });
    }

    const refund = await fetchRefund(request.refund_id);
    if (String(refund.id || '') !== String(request.refund_id)) {
      return json(req, res, 409, { error: 'Refund reference mismatch' });
    }
    const expectedPaise = Math.round(Number(request.refund_amount || 0) * 100);
    if (!(expectedPaise > 0) || Number(refund.amount) !== expectedPaise) {
      return json(req, res, 409, { error: 'Refund amount mismatch' });
    }

    const processorStatus = String(refund.status || '').toLowerCase();
    if (!['pending','processed','failed'].includes(processorStatus)) {
      return json(req, res, 200, {
        reconciled: false,
        status: request.status,
        refund: {
          id: request.refund_id,
          status: request.refund_status || processorStatus || null,
          amount: roundMoney(request.refund_amount),
          reference: request.refund_reference || null,
          destination: 'original_payment_method'
        }
      });
    }

    const now = new Date().toISOString();
    const nextStatus = processorStatus === 'processed'
      ? 'completed'
      : processorStatus === 'failed'
        ? 'approved'
        : 'return_processing';

    const updated = await rest(
      'return_requests?id=eq.' + encodeURIComponent(request.id) +
      '&user_id=eq.' + encodeURIComponent(user.id) +
      '&refund_id=eq.' + encodeURIComponent(request.refund_id),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          status: nextStatus,
          resolved_at: processorStatus === 'processed' ? now : null,
          updated_at: now,
          refund_status: refund.status || null,
          refund_reference: refundReference(refund) || request.refund_reference || null,
          refund_amount: roundMoney(Number(refund.amount || 0) / 100),
          refund_updated_at: now
        })
      }
    );
    const current = updated?.[0] || request;

    return json(req, res, 200, {
      reconciled: true,
      status: current.status || nextStatus,
      return_request_id: request.id,
      refund: {
        id: request.refund_id,
        status: refund.status || null,
        amount: roundMoney(Number(refund.amount || 0) / 100),
        reference: refundReference(refund) || request.refund_reference || null,
        destination: 'original_payment_method',
        speed: refund.speed_processed || refund.speed_requested || null
      }
    });
  } catch (error) {
    console.error('return-refund-status error:', error);
    return json(req, res, error.status || 400, { error: error.message || 'Unable to reconcile return refund' });
  }
};

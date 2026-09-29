const {
  SUPABASE_URL,
  serverHeaders,
  applySecurityHeaders,
  json,
  readRawBody,
  roundMoney
} = require('../lib');
const {
  PAYU_MERCHANT_KEY,
  refundTokenForOrder,
  checkRefundStatus,
  refundDetailFromStatus
} = require('../payu');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Refund callback database request failed');
  return data;
}

function parsePayload(raw, contentType) {
  const text = raw.toString('utf8');
  if (String(contentType || '').toLowerCase().includes('application/json')) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text).entries());
}

function reference(detail, payload, order) {
  return detail?.bank_arn || detail?.bank_ref_num || payload?.bank_arn || payload?.bank_ref_num || order.refund_reference || null;
}

async function loadOrder(requestId) {
  const rows = await rest(
    'orders?payment_provider=eq.payu&refund_id=eq.' + encodeURIComponent(requestId) +
    '&select=id,user_id,status,payment_provider,payu_mihpayid,refund_id,refund_status,refund_reference,refund_amount,refund_updated_at&limit=1'
  );
  return rows?.[0] || null;
}

module.exports = async function payuRefundCallback(req, res) {
  applySecurityHeaders(res);
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });

  try {
    const payload = parsePayload(await readRawBody(req), req.headers?.['content-type']);
    const requestId = String(payload.request_id || '').trim();
    if (!requestId || String(payload.key || '').trim() !== PAYU_MERCHANT_KEY || String(payload.action || '').toLowerCase() !== 'refund') {
      return json(req, res, 400, { ok: false, error: 'Invalid PayU refund callback' });
    }

    const order = await loadOrder(requestId);
    if (!order) return json(req, res, 404, { ok: false, error: 'Refund order not found' });

    const statusResponse = await checkRefundStatus(requestId);
    const detail = refundDetailFromStatus(statusResponse, requestId);
    if (!detail || String(detail.action || '').toLowerCase() !== 'refund') {
      return json(req, res, 202, { ok: true, reconciled: false });
    }
    if (String(detail.mihpayid || '').trim() !== String(order.payu_mihpayid || '').trim()) {
      return json(req, res, 409, { ok: false, error: 'PayU refund payment reference mismatch' });
    }
    if (String(detail.token || '').trim() && String(detail.token).trim() !== refundTokenForOrder(order.id)) {
      return json(req, res, 409, { ok: false, error: 'PayU refund token mismatch' });
    }

    const expected = roundMoney(order.refund_amount || 0);
    const actual = roundMoney(detail.amt || payload.amt || 0);
    if (Math.abs(expected - actual) > 0.009) {
      return json(req, res, 409, { ok: false, error: 'PayU refund amount mismatch' });
    }

    const providerStatus = String(detail.status || '').toLowerCase();
    let nextStatus = null;
    if (providerStatus === 'success') nextStatus = 'refunded';
    else if (providerStatus === 'failure' || providerStatus === 'failed') nextStatus = 'refund_failed';
    else nextStatus = 'refund_pending';

    const now = new Date().toISOString();
    const updated = await rest(
      'orders?id=eq.' + encodeURIComponent(order.id) + '&payment_provider=eq.payu&refund_id=eq.' + encodeURIComponent(requestId),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          status: nextStatus,
          fulfillment_status: 'cancelled',
          fulfillment_updated_at: now,
          refund_status: providerStatus || 'pending',
          refund_reference: reference(detail, payload, order),
          refund_updated_at: now
        })
      }
    );

    return json(req, res, 200, {
      ok: true,
      reconciled: true,
      status: updated?.[0]?.status || nextStatus,
      store_order_id: order.id
    });
  } catch (error) {
    console.error('payu-refund-callback error:', error);
    return json(req, res, 500, { ok: false, error: 'Refund callback processing failed' });
  }
};

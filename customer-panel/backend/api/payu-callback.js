const {
  SUPABASE_URL,
  serverHeaders,
  applySecurityHeaders,
  json,
  readRawBody
} = require('../lib');
const {
  PAYU_MERCHANT_KEY,
  PUBLIC_SITE_URL,
  isPayUConfigured,
  formatAmount,
  verifyResponseHash,
  verifyPayment,
  transactionFromVerification,
  verifiedSuccess
} = require('../payu');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Store database request failed');
  return data;
}

async function rpc(name, args) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { ...serverHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Payment finalization failed');
  return data;
}

function parseForm(raw) {
  const params = new URLSearchParams(raw.toString('utf8'));
  return Object.fromEntries(params.entries());
}

function isWebhook(req) {
  return String(req?.query?.webhook || '') === '1';
}

function redirect(res, path) {
  res.statusCode = 303;
  res.setHeader('Location', PUBLIC_SITE_URL + path);
  res.setHeader('Cache-Control', 'no-store');
  return res.end();
}

function browserResult(res, orderId, state) {
  if (state === 'paid') return redirect(res, '/order-confirmation.html?id=' + encodeURIComponent(orderId));
  return redirect(
    res,
    '/order-details.html?id=' + encodeURIComponent(orderId) + '&payment=' + encodeURIComponent(state) + '#payment'
  );
}

function webhookResult(req, res, status, body) {
  return json(req, res, status, body);
}

async function loadOrder(txnid) {
  const rows = await rest(
    'orders?payu_txnid=eq.' + encodeURIComponent(txnid) +
    '&select=id,user_id,display_order_id,total_amount,status,payment_method,payment_provider,payu_txnid,payu_mihpayid,payu_unmapped_status&limit=1'
  );
  return rows?.[0] || null;
}

async function queuePaymentException(order, type, paymentId, details) {
  try {
    await rpc('record_payment_exception', {
      p_order_id: order.id,
      p_user_id: order.user_id,
      p_exception_type: type,
      p_source: 'payu_callback',
      p_payment_id: paymentId ? String(paymentId) : null,
      p_order_status: order.status || null,
      p_details: details || {}
    });
  } catch (error) {
    console.error('PayU payment exception could not be queued', {
      store_order_id: order.id,
      type,
      error: error.message
    });
  }
}

module.exports = async function payuCallback(req, res) {
  applySecurityHeaders(res);
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });
  const webhook = isWebhook(req);

  try {
    if (!isPayUConfigured()) {
      return webhook
        ? webhookResult(req, res, 503, { ok: false, error: 'PayU server credentials are not configured' })
        : browserResult(res, '', 'pending');
    }

    const payload = parseForm(await readRawBody(req));
    const txnid = String(payload.txnid || '').trim();
    if (!txnid || String(payload.key || '').trim() !== PAYU_MERCHANT_KEY) {
      return webhook
        ? webhookResult(req, res, 400, { ok: false, error: 'Invalid PayU callback identifiers' })
        : redirect(res, '/account.html#orders');
    }
    if (!verifyResponseHash(payload)) {
      console.error('Rejected PayU callback with invalid response hash', { txnid });
      return webhook
        ? webhookResult(req, res, 400, { ok: false, error: 'Invalid PayU response hash' })
        : redirect(res, '/account.html#orders');
    }

    const order = await loadOrder(txnid);
    if (!order) {
      return webhook
        ? webhookResult(req, res, 404, { ok: false, error: 'Order not found' })
        : redirect(res, '/account.html#orders');
    }
    if (order.payment_method !== 'prepaid' || order.payment_provider !== 'payu') {
      return webhook
        ? webhookResult(req, res, 409, { ok: false, error: 'Order is not a PayU prepaid order' })
        : browserResult(res, order.id, 'pending');
    }
    if (String(payload.udf1 || '') !== String(order.id)) {
      return webhook
        ? webhookResult(req, res, 400, { ok: false, error: 'Order reference mismatch' })
        : browserResult(res, order.id, 'pending');
    }
    if (String(payload.amount || '') !== formatAmount(order.total_amount)) {
      await queuePaymentException(order, 'payu_amount_mismatch', payload.mihpayid, {
        callback_amount: String(payload.amount || ''),
        expected_amount: formatAmount(order.total_amount),
        txnid
      });
      return webhook
        ? webhookResult(req, res, 409, { ok: false, error: 'Payment amount mismatch' })
        : browserResult(res, order.id, 'pending');
    }

    const callbackStatus = String(payload.status || '').toLowerCase();
    if (callbackStatus !== 'success') {
      await rest('orders?id=eq.' + encodeURIComponent(order.id) + '&payment_provider=eq.payu', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payu_unmapped_status: String(payload.unmappedstatus || callbackStatus || 'failed') })
      }).catch(() => null);
      return webhook
        ? webhookResult(req, res, 200, { ok: true, verified: true, paid: false, status: callbackStatus || 'failure' })
        : browserResult(res, order.id, 'failed');
    }

    let verification;
    try {
      verification = await verifyPayment(txnid);
    } catch (error) {
      console.error('PayU Verify Payment API failed after signed callback', { txnid, error: error.message });
      return webhook
        ? webhookResult(req, res, 202, { ok: true, verified: false, pending: true })
        : browserResult(res, order.id, 'pending');
    }

    const transaction = transactionFromVerification(verification, txnid);
    if (!transaction || !verifiedSuccess(transaction)) {
      return webhook
        ? webhookResult(req, res, 202, { ok: true, verified: false, pending: true })
        : browserResult(res, order.id, 'pending');
    }
    if (formatAmount(transaction.amount) !== formatAmount(order.total_amount)) {
      await queuePaymentException(order, 'payu_verified_amount_mismatch', transaction.mihpayid || payload.mihpayid, {
        verified_amount: String(transaction.amount || ''),
        expected_amount: formatAmount(order.total_amount),
        txnid
      });
      return webhook
        ? webhookResult(req, res, 409, { ok: false, error: 'Verified payment amount mismatch' })
        : browserResult(res, order.id, 'pending');
    }

    const callbackPayUId = String(payload.mihpayid || '').trim();
    const verifiedPayUId = String(transaction.mihpayid || callbackPayUId).trim();
    if (!verifiedPayUId) {
      return webhook
        ? webhookResult(req, res, 202, { ok: true, verified: false, pending: true })
        : browserResult(res, order.id, 'pending');
    }
    if (callbackPayUId && verifiedPayUId !== callbackPayUId) {
      await queuePaymentException(order, 'payu_payment_reference_mismatch', verifiedPayUId, {
        callback_mihpayid: callbackPayUId,
        verified_mihpayid: verifiedPayUId,
        txnid
      });
      return webhook
        ? webhookResult(req, res, 409, { ok: false, error: 'PayU payment reference mismatch' })
        : browserResult(res, order.id, 'pending');
    }
    if (order.payu_mihpayid && String(order.payu_mihpayid) !== verifiedPayUId) {
      await queuePaymentException(order, 'different_payment_reference', verifiedPayUId, {
        existing_payu_mihpayid: String(order.payu_mihpayid),
        txnid
      });
      return webhook
        ? webhookResult(req, res, 409, { ok: false, error: 'Order is linked to a different payment' })
        : browserResult(res, order.id, 'pending');
    }

    if (order.status !== 'paid' && !['creating', 'created'].includes(String(order.status || '').toLowerCase())) {
      await queuePaymentException(order, 'inactive_order_capture', verifiedPayUId, {
        txnid,
        verified_status: String(transaction.status || ''),
        unmappedstatus: String(transaction.unmappedstatus || transaction.unmapped_status || '')
      });
      return webhook
        ? webhookResult(req, res, 409, { ok: false, captured: true, manual_review: true })
        : browserResult(res, order.id, 'pending');
    }

    await rpc('finalize_payu_checkout_order', {
      p_order_id: order.id,
      p_user_id: order.user_id,
      p_txnid: txnid,
      p_mihpayid: verifiedPayUId,
      p_unmapped_status: String(transaction.unmappedstatus || transaction.unmapped_status || payload.unmappedstatus || ''),
      p_source: webhook ? 'payu_webhook_verify' : 'payu_browser_callback_verify'
    });

    try {
      await rpc('commit_order_inventory', { p_order_id: order.id });
    } catch (error) {
      console.error('PayU payment finalized but inventory commit needs reconciliation', {
        store_order_id: order.id,
        error: error.message
      });
    }

    return webhook
      ? webhookResult(req, res, 200, {
          ok: true,
          verified: true,
          paid: true,
          store_order_id: order.id,
          display_order_id: order.display_order_id
        })
      : browserResult(res, order.id, 'paid');
  } catch (error) {
    console.error('payu-callback error:', error);
    return webhook
      ? webhookResult(req, res, 500, { ok: false, error: 'PayU callback processing failed' })
      : redirect(res, '/account.html#orders');
  }
};

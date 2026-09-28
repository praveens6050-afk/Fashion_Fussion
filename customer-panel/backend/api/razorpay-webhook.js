const crypto = require('crypto');
const {
  WEBHOOK_SECRET,
  SUPABASE_URL,
  serverHeaders,
  json,
  readRawBody,
  safeEqualText,
  roundMoney
} = require('../lib');
const { isZohoMailConfigured, sendZohoMail } = require('../zoho-mail');

const ACTIVE_CHECKOUT_STATUSES = new Set(['creating', 'created']);
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || 'https://fashionfussion.in').replace(/\/+$/, '');
const PAYMENT_EMAIL_CLAIM_TTL_MS = 5 * 60 * 1000;

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
  if (!response.ok) throw new Error(data?.message || data?.error || 'Could not finalize checkout');
  return data;
}

async function recordPaymentException(order, type, paymentId, details = {}) {
  await rpc('record_payment_exception', {
    p_order_id: order.id,
    p_user_id: order.user_id,
    p_exception_type: type,
    p_source: 'razorpay_webhook',
    p_payment_id: paymentId ? String(paymentId) : null,
    p_order_status: order.status || null,
    p_details: details
  });
}

async function loadOrderByRazorpayOrder(id) {
  const rows = await rest(
    'orders?razorpay_order_id=eq.' + encodeURIComponent(id) +
    '&select=id,user_id,display_order_id,total_amount,currency,status,payment_method,razorpay_payment_id,customer_name,customer_email,items,created_at&limit=1'
  );
  return rows?.[0] || null;
}

async function loadOrderByPayment(id) {
  const rows = await rest(
    'orders?razorpay_payment_id=eq.' + encodeURIComponent(id) +
    '&select=id,user_id,total_amount,status,payment_method,fulfillment_status,items,coupon_discount,gift_card_discount,razorpay_payment_id,refund_id,refund_status,refund_reference,refund_amount,refund_updated_at&limit=1'
  );
  return rows?.[0] || null;
}

async function loadReturnRequestByRefund(refund) {
  if (!refund?.id) return null;
  const noteId = Number(refund?.notes?.return_request_id);
  let rows = await rest(
    'return_requests?refund_id=eq.' + encodeURIComponent(refund.id) +
    '&select=id,order_id,request_type,status,refund_id,refund_status,refund_reference,refund_amount,refund_updated_at&limit=1'
  );
  if (rows?.[0]) return rows[0];
  if (Number.isInteger(noteId) && noteId > 0) {
    rows = await rest(
      'return_requests?id=eq.' + encodeURIComponent(noteId) +
      '&select=id,order_id,request_type,status,refund_id,refund_status,refund_reference,refund_amount,refund_updated_at&limit=1'
    );
    return rows?.[0] || null;
  }
  return null;
}

function expectedRefundAmount(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = roundMoney(items.reduce((s, i) => s + Number(i?.taxable_amount ?? (Number(i?.unit_price || 0) * Number(i?.qty || 1))), 0));
  const gst = roundMoney(items.reduce((s, i) => s + Number(i?.gst_amount || 0), 0));
  const coupon = roundMoney(order.coupon_discount || 0);
  const gift = roundMoney(order.gift_card_discount || 0);
  const total = roundMoney(order.total_amount || 0);
  const delivery = roundMoney(Math.max(0, total - subtotal - gst + coupon + gift));
  return roundMoney(Math.max(0, total - delivery));
}

function refundReference(refund) {
  return refund?.acquirer_data?.arn || refund?.acquirer_data?.rrn || refund?.acquirer_data?.utr || null;
}

async function updateReturnRefundStatus(request, refund) {
  if (!request || request.request_type !== 'return_refund') return null;
  if (request.refund_id && String(request.refund_id) !== String(refund.id)) return null;
  const processorStatus = String(refund?.status || '').toLowerCase();
  if (!['pending', 'processed', 'failed'].includes(processorStatus)) return null;
  const expectedPaise = Math.round(Number(request.refund_amount || 0) * 100);
  if (!(expectedPaise > 0) || Number(refund.amount) !== expectedPaise) return null;
  const now = new Date().toISOString();
  const nextStatus = processorStatus === 'processed' ? 'completed' : processorStatus === 'failed' ? 'approved' : 'return_processing';
  const updated = await rest(
    'return_requests?id=eq.' + encodeURIComponent(request.id) + '&request_type=eq.return_refund&status=in.(approved,return_processing,completed)',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        status: nextStatus,
        resolved_at: processorStatus === 'processed' ? now : null,
        updated_at: now,
        refund_id: refund.id,
        refund_status: refund.status || null,
        refund_reference: refundReference(refund) || request.refund_reference || null,
        refund_amount: roundMoney(Number(refund.amount || 0) / 100),
        refund_updated_at: now
      })
    }
  );
  return updated?.[0] || null;
}

async function updateRefundStatus(order, nextStatus, refund) {
  const allowed = nextStatus === 'refunded'
    ? 'in.(refund_initiated,refund_pending,refunded)'
    : nextStatus === 'refund_pending'
      ? 'in.(paid,refund_initiated,refund_pending)'
      : 'in.(refund_initiated,refund_pending,refund_failed)';
  const now = new Date().toISOString();
  const updated = await rest('orders?id=eq.' + encodeURIComponent(order.id) + '&status=' + allowed, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      status: nextStatus,
      fulfillment_status: 'cancelled',
      fulfillment_updated_at: now,
      refund_id: refund?.id || order.refund_id || null,
      refund_status: refund?.status || null,
      refund_reference: refundReference(refund) || order.refund_reference || null,
      refund_amount: roundMoney(Number(refund?.amount || 0) / 100),
      refund_updated_at: now
    })
  });
  return updated?.[0] || null;
}

async function commitOrderInventory(id) {
  await rpc('commit_order_inventory', { p_order_id: id });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value, currency = 'INR') {
  const amount = Number(value || 0);
  if (String(currency || 'INR').toUpperCase() === 'INR') return '₹' + amount.toFixed(2);
  return String(currency || '') + ' ' + amount.toFixed(2);
}

function paymentRecoveryLink(order) {
  return PUBLIC_SITE_URL + '/order-details.html?id=' + encodeURIComponent(order.id) + '#payment';
}

function paymentFailureEmail(order) {
  const displayOrderId = String(order.display_order_id || order.id);
  const items = Array.isArray(order.items) ? order.items : [];
  const rows = items.slice(0, 30).map(item => {
    const variant = [item?.variant_title, item?.size, item?.color].filter(Boolean).join(' · ');
    return '<tr>' +
      '<td style="padding:10px 0;border-bottom:1px solid #eceff3;vertical-align:top">' +
        '<div style="font-weight:700;color:#101828">' + escapeHtml(item?.name || 'Item') + '</div>' +
        (variant ? '<div style="font-size:12px;color:#667085;margin-top:3px">' + escapeHtml(variant) + '</div>' : '') +
      '</td>' +
      '<td style="padding:10px 8px;border-bottom:1px solid #eceff3;text-align:center;vertical-align:top">' + escapeHtml(item?.qty || 1) + '</td>' +
      '<td style="padding:10px 0;border-bottom:1px solid #eceff3;text-align:right;vertical-align:top;font-weight:700">' +
        escapeHtml(money(item?.line_total ?? (Number(item?.unit_price || 0) * Number(item?.qty || 1)), order.currency)) +
      '</td>' +
    '</tr>';
  }).join('');
  const hiddenCount = Math.max(0, items.length - 30);
  const retryUrl = paymentRecoveryLink(order);

  return {
    subject: 'Payment failed for order ' + displayOrderId + ' — complete your payment',
    html: '<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#101828">' +
      '<div style="max-width:640px;margin:0 auto;padding:28px 16px">' +
        '<div style="background:#ffffff;border:1px solid #eaecf0;border-radius:18px;overflow:hidden">' +
          '<div style="padding:24px 28px;background:#111827;color:#ffffff">' +
            '<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Fashion Fussion</div>' +
            '<h1 style="font-size:24px;line-height:1.25;margin:8px 0 0">Your payment was not completed</h1>' +
          '</div>' +
          '<div style="padding:28px">' +
            '<p style="margin:0 0 16px;line-height:1.6">Hi ' + escapeHtml(order.customer_name || 'there') + ',</p>' +
            '<p style="margin:0 0 22px;line-height:1.6;color:#475467">We could not complete the payment for order <strong>' + escapeHtml(displayOrderId) + '</strong>. Your order is still in its secure payment window, so you can retry without creating a duplicate order.</p>' +
            '<div style="border:1px solid #eaecf0;border-radius:14px;padding:18px;margin-bottom:22px">' +
              '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:10px"><span style="color:#667085">Order</span><strong>' + escapeHtml(displayOrderId) + '</strong></div>' +
              '<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#667085">Amount to pay</span><strong style="font-size:18px">' + escapeHtml(money(order.total_amount, order.currency)) + '</strong></div>' +
            '</div>' +
            (rows ? '<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:18px"><thead><tr><th style="text-align:left;padding:0 0 8px;color:#667085;font-size:12px">ITEM</th><th style="text-align:center;padding:0 8px 8px;color:#667085;font-size:12px">QTY</th><th style="text-align:right;padding:0 0 8px;color:#667085;font-size:12px">TOTAL</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
            (hiddenCount ? '<p style="font-size:12px;color:#667085;margin:0 0 18px">+' + hiddenCount + ' more item(s)</p>' : '') +
            '<div style="text-align:center;margin:26px 0">' +
              '<a href="' + escapeHtml(retryUrl) + '" style="display:inline-block;background:#5b35e5;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:10px">Retry payment</a>' +
            '</div>' +
            '<p style="margin:0;color:#667085;font-size:13px;line-height:1.6">For your security, this button opens Fashion Fussion first. You may be asked to sign in before payment continues. We never send card, UPI PIN, OTP, or banking credentials by email.</p>' +
          '</div>' +
        '</div>' +
        '<p style="text-align:center;color:#98a2b3;font-size:12px;line-height:1.5;margin:16px 0 0">If you already completed the payment, please check My Orders before trying again.</p>' +
      '</div>' +
    '</body></html>'
  };
}

async function loadPaymentRecoveryNotification(paymentId) {
  const rows = await rest(
    'payment_recovery_notifications?event_type=eq.payment_failed&payment_id=eq.' + encodeURIComponent(paymentId) +
    '&select=id,status,attempt_count,last_attempt_at,sent_at&limit=1'
  );
  return rows?.[0] || null;
}

async function claimPaymentRecoveryNotification(order, payment) {
  const now = new Date();
  const existing = await loadPaymentRecoveryNotification(payment.id);
  if (existing?.status === 'sent') return { send: false, reason: 'already_sent', notification: existing };
  if (existing?.status === 'pending') {
    const lastAttempt = new Date(existing.last_attempt_at || 0).getTime();
    if (Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < PAYMENT_EMAIL_CLAIM_TTL_MS) {
      return { send: false, reason: 'in_progress', notification: existing };
    }
  }

  const recipient = String(order.customer_email || '').trim().toLowerCase();
  if (existing) {
    const rows = await rest('payment_recovery_notifications?id=eq.' + encodeURIComponent(existing.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'pending',
        recipient_email: recipient,
        attempt_count: Number(existing.attempt_count || 0) + 1,
        last_attempt_at: now.toISOString(),
        last_error: null
      })
    });
    return { send: true, notification: rows?.[0] || existing };
  }

  try {
    const rows = await rest('payment_recovery_notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        order_id: order.id,
        user_id: order.user_id,
        payment_id: String(payment.id),
        event_type: 'payment_failed',
        recipient_email: recipient,
        provider: 'zoho_mail',
        status: 'pending',
        attempt_count: 1,
        last_attempt_at: now.toISOString()
      })
    });
    return { send: true, notification: rows?.[0] || null };
  } catch (error) {
    const raced = await loadPaymentRecoveryNotification(payment.id).catch(() => null);
    if (raced) return { send: false, reason: raced.status === 'sent' ? 'already_sent' : 'in_progress', notification: raced };
    throw error;
  }
}

async function markPaymentRecoveryNotification(id, values) {
  if (!id) return;
  await rest('payment_recovery_notifications?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values)
  });
}

async function handlePaymentFailed(event) {
  const payment = event?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id || String(payment.status || '').toLowerCase() !== 'failed') {
    return { received: true, ignored: true };
  }

  const order = await loadOrderByRazorpayOrder(payment.order_id);
  if (!order || order.payment_method !== 'prepaid') return { received: true, ignored: true };
  if (Math.round(Number(order.total_amount) * 100) !== Number(payment.amount)) {
    return { received: true, ignored: true, reason: 'payment_amount_mismatch' };
  }

  const orderStatus = String(order.status || '').toLowerCase();
  if (orderStatus === 'paid' || order.razorpay_payment_id) {
    return { received: true, ignored: true, reason: 'order_already_paid' };
  }
  if (!ACTIVE_CHECKOUT_STATUSES.has(orderStatus)) {
    return { received: true, ignored: true, reason: 'order_not_in_active_checkout' };
  }
  if (!isZohoMailConfigured()) {
    console.warn('Zoho Mail payment recovery email skipped because configuration is missing', { store_order_id: order.id });
    return { received: true, payment_failed: true, email_skipped: true, reason: 'zoho_not_configured' };
  }

  const recipient = String(order.customer_email || '').trim();
  if (!recipient || !recipient.includes('@')) {
    return { received: true, payment_failed: true, email_skipped: true, reason: 'customer_email_missing' };
  }

  const claim = await claimPaymentRecoveryNotification(order, payment);
  if (!claim.send) {
    return { received: true, payment_failed: true, email_deduplicated: true, reason: claim.reason };
  }

  try {
    const message = paymentFailureEmail(order);
    const sent = await sendZohoMail({ to: recipient, subject: message.subject, html: message.html });
    await markPaymentRecoveryNotification(claim.notification?.id, {
      status: 'sent',
      provider_message_id: sent.messageId || sent.mailId || null,
      last_error: null,
      sent_at: new Date().toISOString()
    });
    return {
      received: true,
      payment_failed: true,
      email_sent: true,
      store_order_id: order.id
    };
  } catch (error) {
    console.error('Zoho payment recovery email failed', { store_order_id: order.id, error: error.message });
    await markPaymentRecoveryNotification(claim.notification?.id, {
      status: 'failed',
      last_error: String(error.message || 'Zoho Mail send failed').slice(0, 500)
    }).catch(() => null);
    return {
      received: true,
      payment_failed: true,
      email_failed: true,
      store_order_id: order.id
    };
  }
}

async function handlePaymentCaptured(event) {
  const payment = event?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id || payment.status !== 'captured') return { received: true, ignored: true };
  const order = await loadOrderByRazorpayOrder(payment.order_id);
  if (!order || order.payment_method !== 'prepaid') return { received: true, ignored: true };
  if (Math.round(Number(order.total_amount) * 100) !== Number(payment.amount)) {
    const e = new Error('Payment amount mismatch');
    e.status = 409;
    throw e;
  }
  if (order.razorpay_payment_id && String(order.razorpay_payment_id) !== String(payment.id)) {
    console.error('Webhook captured payment conflicts with existing payment link', { store_order_id: order.id });
    await recordPaymentException(order, 'different_payment_reference', payment.id, {
      existing_payment_id: String(order.razorpay_payment_id),
      razorpay_order_id: String(payment.order_id)
    });
    return {
      received: true,
      captured: true,
      manual_review: true,
      review_queued: true,
      reason: 'different_payment_reference',
      store_order_id: order.id,
      status: order.status
    };
  }
  if (order.status === 'paid') {
    await commitOrderInventory(order.id);
    return { received: true, already_processed: true, inventory_reconciled: true };
  }
  if (!ACTIVE_CHECKOUT_STATUSES.has(String(order.status || '').toLowerCase())) {
    console.error('Webhook captured payment requires manual review for inactive order', { store_order_id: order.id, status: order.status });
    await recordPaymentException(order, 'inactive_order_capture', payment.id, {
      razorpay_order_id: String(payment.order_id)
    });
    return {
      received: true,
      captured: true,
      manual_review: true,
      review_queued: true,
      reason: 'inactive_order',
      store_order_id: order.id,
      status: order.status
    };
  }
  await rpc('finalize_checkout_order', {
    p_order_id: order.id,
    p_user_id: order.user_id,
    p_payment_id: String(payment.id),
    p_payment_signature: null,
    p_target_status: 'paid',
    p_source: 'razorpay_webhook'
  });
  await commitOrderInventory(order.id);
  return { received: true, finalized: true, inventory_committed: true, store_order_id: order.id };
}

async function handleRefundEvent(event) {
  const refund = event?.payload?.refund?.entity;
  if (!refund?.id || !refund?.payment_id) return { received: true, ignored: true };
  const request = await loadReturnRequestByRefund(refund);
  if (request) {
    const ps = String(refund.status || '').toLowerCase();
    if (!['pending', 'processed', 'failed'].includes(ps)) {
      return { received: true, ignored: true, reason: 'unexpected_return_refund_status' };
    }
    const updated = await updateReturnRefundStatus(request, refund);
    if (!updated) return { received: true, ignored: true, reason: 'return_refund_mismatch' };
    return {
      received: true,
      return_refund_updated: true,
      return_request_id: request.id,
      status: updated.status,
      refund_status: updated.refund_status
    };
  }

  const order = await loadOrderByPayment(refund.payment_id);
  if (!order || order.payment_method !== 'prepaid') return { received: true, ignored: true };
  if (order.refund_id && String(order.refund_id) !== String(refund.id)) {
    return { received: true, ignored: true, reason: 'different_refund_reference' };
  }
  if (Number(refund.amount) !== Math.round(expectedRefundAmount(order) * 100)) {
    return { received: true, ignored: true, reason: 'refund_amount_mismatch' };
  }

  if (event.event === 'refund.created') {
    if (!['pending', 'processed'].includes(String(refund.status || '').toLowerCase())) {
      return { received: true, ignored: true, reason: 'unexpected_refund_status' };
    }
    const processed = String(refund.status).toLowerCase() === 'processed';
    const updated = await updateRefundStatus(order, processed ? 'refunded' : 'refund_pending', refund);
    if (!updated && order.status !== (processed ? 'refunded' : 'refund_pending')) {
      return { received: true, ignored: true, reason: 'order_not_waiting_for_refund' };
    }
    return { received: true, [processed ? 'refund_processed' : 'refund_pending']: true, store_order_id: order.id };
  }

  if (event.event === 'refund.processed') {
    if (String(refund.status || '').toLowerCase() !== 'processed') {
      return { received: true, ignored: true, reason: 'unexpected_refund_status' };
    }
    const updated = await updateRefundStatus(order, 'refunded', refund);
    if (!updated && order.status !== 'refunded') {
      return { received: true, ignored: true, reason: 'order_not_waiting_for_refund' };
    }
    return { received: true, refund_processed: true, store_order_id: order.id };
  }

  if (event.event === 'refund.failed') {
    if (String(refund.status || '').toLowerCase() !== 'failed') {
      return { received: true, ignored: true, reason: 'unexpected_refund_status' };
    }
    const updated = await updateRefundStatus(order, 'refund_failed', refund);
    if (!updated && order.status !== 'refund_failed') {
      return { received: true, ignored: true, reason: 'order_not_waiting_for_refund' };
    }
    return { received: true, refund_failed: true, store_order_id: order.id };
  }

  return { received: true, ignored: true };
}

module.exports = async function razorpayWebhook(req, res) {
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });
  if (!WEBHOOK_SECRET) return json(req, res, 503, { error: 'Razorpay webhook secret is not configured' });

  try {
    const raw = await readRawBody(req);
    const received = String(req.headers['x-razorpay-signature'] || '');
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (!received || !safeEqualText(expected, received)) {
      return json(req, res, 401, { error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(raw.toString('utf8') || '{}');
    let result;
    if (event.event === 'payment.captured') result = await handlePaymentCaptured(event);
    else if (event.event === 'payment.failed') result = await handlePaymentFailed(event);
    else if (['refund.created', 'refund.processed', 'refund.failed'].includes(event.event)) result = await handleRefundEvent(event);
    else result = { received: true, ignored: true };
    return json(req, res, 200, result);
  } catch (error) {
    console.error('razorpay-webhook error:', error);
    return json(req, res, error.status || 500, { error: error.message || 'Webhook processing failed' });
  }
};

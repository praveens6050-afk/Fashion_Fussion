// Server-only bridge: confirmed checkout -> protected Orders Zoho dispatcher.
// Never imported by browser code. Feature is OFF by default in customer Pages.
// Calls do not make payment / inventory / checkout success contingent on email.
const DISPATCH_URL =
  'https://seller.fashionfussion.in/api/outreach/zoho-confirmation-dispatch';
const TIMEOUT_MS = 3500;

function settings() {
  const enabled = process.env.FF_ORDER_EMAIL_HOOK_ENABLED === 'true';
  const token = String(process.env.ZOHO_ORDER_EVENT_TOKEN || '').trim();
  return { enabled, token };
}

function validOrderId(id) {
  const s = String(id ?? '');
  return /^[1-9]\d{0,14}$/.test(s) && Number.isSafeInteger(Number(s));
}

// Promise resolves to a redacted result. It NEVER leaks customer/order PII.
// A failed/missing notification will be visible in pending_review outbox status.
async function notifyConfirmedOrder(orderId, source = 'unknown') {
  const { enabled, token } = settings();
  if (!enabled) return { skipped: true, reason: 'customer_hook_disabled' };
  if (!validOrderId(orderId)) return { skipped: true, reason: 'invalid_order_id' };
  // Fail closed if someone saved a placeholder / weak shared credential.
  if (token.length < 40) {
    console.warn('Order email hook disabled: service token missing or too short');
    return { skipped: true, reason: 'service_token_not_configured' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({ orderId: Number(orderId), confirmSend: true })
    });
    // Only claim acceptance if the seller dispatcher explicitly confirms ONE send.
    // A proxy/HTML 200 or unreadable response is NOT evidence of Zoho acceptance.
    const provider = await response.json().catch(() => null);
    if (response.ok && provider?.accepted === true && provider?.sent === 1) {
      return { accepted: true, attempted: true };
    }
    if (response.ok) return {accepted:false,attempted:true,uncertainOutcome:true};
    // Do not log/propagate personal details or headers. Do not automatically retry.
    if (response.status === 409) return { skipped: true, reason: 'not_eligible_or_duplicate' };
    if (response.status === 423) return { skipped: true, reason: 'seller_sending_disabled' };
    console.warn('Order email hook not confirmed', {
      source: String(source).slice(0, 40),
      httpStatus: response.status
    });
    return { accepted: false, attempted: true, status: response.status };
  } catch (error) {
    // Timeout may occur AFTER Zoho accepted; never retry blindly.
    console.warn('Order email hook result uncertain', {
      source: String(source).slice(0, 40),
      type: error?.name === 'AbortError' ? 'timeout' : 'network_failure'
    });
    return { accepted: false, attempted: true, uncertainOutcome: true };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { notifyConfirmedOrder };

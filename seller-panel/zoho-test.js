'use strict';
(() => {
  const tokenField = document.getElementById('token');
  const recipientField = document.getElementById('recipient');
  const result = document.getElementById('result');
  const verifyButton = document.getElementById('verify');
  const verifyOrdersButton = document.getElementById('verifyOrders');
  const probeOrderLinkButton = document.getElementById('probeOrderLink');
  const sendOrdersButton = document.getElementById('sendOrders');
  const previewConfirmationButton = document.getElementById('previewConfirmation');
  const sendVerifiedConfirmationButton = document.getElementById('sendVerifiedConfirmation');
  const orderIdField = document.getElementById('orderId');
  const sendButton = document.getElementById('send');
  const form = document.getElementById('testForm');
  let verifiedToken = null;
  let verifiedOrdersToken = null;
  let busy = false;
  let hasSent = false;
  let verifiedConfirmation = null;
  const setStatus = (text) => { result.textContent = text; };
  const refresh = () => {
    verifyButton.disabled = busy || hasSent;
    verifyOrdersButton.disabled = busy || hasSent;
    probeOrderLinkButton.disabled = busy || hasSent;
    previewConfirmationButton.disabled = busy || hasSent;
    sendVerifiedConfirmationButton.disabled = busy || hasSent ||
      !verifiedConfirmation ||
      verifiedConfirmation.token !== tokenField.value.trim() ||
      verifiedConfirmation.orderId !== orderIdField.value.trim();
    sendOrdersButton.disabled = busy || hasSent || verifiedOrdersToken !== tokenField.value.trim() ||
      recipientField.value.trim().toLowerCase() !== 'ps4038267@gmail.com';
    sendButton.disabled = busy || hasSent || verifiedToken !== tokenField.value.trim() ||
      !recipientField.validity.valid || !recipientField.value.trim();
  };
  const request = async (route, body, token) => {
    const response = await fetch(route, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({ error: 'Unexpected non-JSON server response' }));
    return { response, data };
  };
  tokenField.addEventListener('input', () => {
    verifiedToken = null; verifiedOrdersToken = null; verifiedConfirmation = null; refresh();
  });
  orderIdField.addEventListener('input', () => { verifiedConfirmation = null; refresh(); });
  recipientField.addEventListener('input', refresh);
  verifyButton.addEventListener('click', async () => {
    const token = tokenField.value.trim();
    if (!token) { setStatus('Enter the outreach API token first.'); return; }
    busy = true; verifiedToken = null; refresh();
    setStatus('Checking Zoho OAuth and sender account. This will NOT send any email...');
    try {
      const { response, data } = await request('/api/outreach/zoho-verify', { dryRun: true }, token);
      if (response.ok && data.ready === true) {
        verifiedToken = token;
        setStatus('Zoho OAuth and sender account are ready. No email has been sent. Enter your inbox and tap Send.');
      } else {
        setStatus('Verification not ready (' + response.status + '). Issue: ' +
          String(data.issue || data.error || 'unknown').slice(0, 180) +
          (Array.isArray(data.missingConfiguration) ? '. Missing: ' + data.missingConfiguration.join(', ') : '') +
          '. No email sent.');
      }
    } catch {
      setStatus('Could not reach the verification endpoint. No email sent.');
    } finally { busy = false; refresh(); }
  });
  probeOrderLinkButton.addEventListener('click', async () => {
    if (busy || hasSent) return;
    const token = tokenField.value.trim();
    if (!token) { setStatus('Enter OUTREACH_API_TOKEN first. The separate event secret stays on Cloudflare.'); return; }
    busy = true; refresh();
    setStatus('Testing private Customer ↔ Seller token handshake (no email, order or payment)...');
    try {
      const { response, data } = await request('/api/outreach/zoho-order-link-test',
        { dryRun: true }, token);
      if (response.ok && data.connected === true && data.customerSecretMatchesSeller === true) {
        setStatus('SUCCESS: Cloudflare Customer and Seller share the same private order-event token. ' +
          'Connection route: ' + String(data.endpointUsed || 'custom_domain') + '. ' +
          'Customer hook enabled: ' + String(data.customerHookEnabled) +
          '; Seller sending enabled: ' + String(data.sellerSendingEnabled) +
          '. No email, order or payment was created.');
      } else {
        const customerHttp=Number.isInteger(data.customerHttpStatus) ?
          ' Customer HTTP ' + data.customerHttpStatus + '.' : '';
        const diagnostic=String(data.diagnosticCode || 'NO_DIAGNOSTIC').slice(0, 90);
        const responseType=String(data.customerResponseType || 'unknown').slice(0, 24);
        setStatus('Connection NOT verified (Seller HTTP ' + response.status + '). ' +
          'Code: ' + diagnostic + '.' + customerHttp +
          ' Customer response type: ' + responseType + '. ' +
          'Route: ' + String(data.endpointUsed || 'unknown').slice(0, 30) + '. ' +
          String(data.error || 'Unknown connection issue').slice(0, 180) +
          '. No email, order or payment was created. Do not enable sending flags.');
      }
    } catch {
      setStatus('Connection check unreachable. Confirm latest Customer and Seller deployments. No email sent.');
    } finally { busy = false; refresh(); }
  });

  verifyOrdersButton.addEventListener('click', async () => {
    if (busy || hasSent) return;
    const token = tokenField.value.trim();
    if (!token) { setStatus('Enter the outreach API token first.'); return; }
    busy = true;
    verifiedOrdersToken = null;
    verifiedToken = null; // Orders verification never enables the Sales test-send button.
    refresh();
    setStatus('Verifying the separate orders@fashionfussion.in Zoho mailbox. No email will be sent...');
    try {
      const { response, data } = await request('/api/outreach/zoho-verify', {
        dryRun: true, purpose: 'order_confirmation'
      }, token);
      if (response.ok && data.ready === true && data.fromAddressAuthorized === true) {
        verifiedOrdersToken = token;
        setStatus('Success: orders@fashionfussion.in is authorized. To send ONE live Orders test email, enter ps4038267@gmail.com and tap Send one email from orders@. No email sent yet.');
      } else {
        setStatus('Orders mailbox NOT verified (' + response.status + '). Issue: ' +
          String(data.issue || data.error || 'unknown').slice(0, 180) +
          '. Check the dedicated Orders OAuth credentials, Account ID and sender address. No email sent.');
      }
    } catch {
      setStatus('Could not reach the Zoho alias verifier. No email sent.');
    } finally { busy = false; refresh(); }
  });

  sendOrdersButton.addEventListener('click', async () => {
    if (busy || hasSent || verifiedOrdersToken !== tokenField.value.trim() ||
        recipientField.value.trim().toLowerCase() !== 'ps4038267@gmail.com') return;
    if (!window.confirm('Send ONE real test email from orders@fashionfussion.in to ps4038267@gmail.com? This is not an actual order notification.')) return;
    busy = true;
    hasSent = true; // Once attempted, fail closed, including uncertain network outcomes.
    refresh();
    setStatus('Submitting ONE Orders mailbox test email to Zoho. Do not retry.');
    try {
      const { response, data } = await request('/api/outreach/zoho-orders-test-send', {
        confirmOrdersTestSend: true, to: 'ps4038267@gmail.com'
      }, verifiedOrdersToken);
      if (response.ok && data.accepted === true && data.sent === 1) {
        setStatus('Zoho accepted ONE email from orders@fashionfussion.in to ps4038267@gmail.com. Check Gmail Inbox/Spam to confirm arrival. Acceptance alone does not guarantee delivery. Automatic order notifications are still disabled.');
      } else {
        setStatus('Orders test send not confirmed (' + response.status + '). ' +
          String(data.error || 'Unknown provider response').slice(0, 200) +
          ' Check Orders Sent folder and recipient Inbox before any retry.');
      }
    } catch {
      setStatus('Network error: Orders test send outcome UNKNOWN. Check Sent and recipient Inbox before any retry.');
    } finally {
      verifiedOrdersToken = null;
      verifiedToken = null;
      tokenField.value = '';
      busy = false;
      refresh();
    }
  });

  previewConfirmationButton.addEventListener('click', async () => {
    if (busy || hasSent) return;
    const token = tokenField.value.trim();
    const orderId = orderIdField.value.trim();
    if (!token) { setStatus('Enter the outreach API token first.'); return; }
    if (!/^[1-9]\d{0,14}$/.test(orderId) || !Number.isSafeInteger(Number(orderId))) {
      setStatus('Enter a valid numeric Order ID for this read-only check.'); return;
    }
    verifiedConfirmation = null;
    busy = true; refresh();
    setStatus('Checking order confirmation queue (no email will be sent)...');
    try {
      const { response, data } = await request('/api/outreach/zoho-confirmation-dispatch', {
        orderId: Number(orderId), dryRun: true
      }, token);
      if (response.ok && data.dryRun === true) {
        const pilotReady = data.eligibility?.eligible === true &&
          data.eligibility?.reason === 'ELIGIBLE_FOR_CONTROLLED_TEST' &&
          data.ordersConfigPresent === true &&
          data.liveSendingEnabled === true &&
          data.pilotAllowlisted === true &&
          (data.eventState === 'pending_review' || data.eventState === 'ready') &&
          data.attemptCount === 0;
        if (pilotReady) verifiedConfirmation = {orderId, token};
        setStatus('Order #' + orderId + ' — staged: ' + String(data.eventStaged) +
          '; queue status: ' + String(data.eventState || 'none') +
          '; attempts: ' + String(data.attemptCount || 0) +
          '; provider configuration present: ' + String(data.ordersConfigPresent) +
          '; live sending enabled: ' + String(data.liveSendingEnabled) +
          '; this order allowlisted: ' + String(data.pilotAllowlisted === true) +
          '; eligible for controlled test: ' + String(data.eligibility?.eligible === true) +
          '; reason: ' + String(data.eligibility?.reason || 'UNKNOWN').slice(0,90) +
          (pilotReady ? '. ONE real email pilot is now unlocked, with a separate confirmation.' :
            '. Send stays LOCKED. Check seller feature flag/eligibility; no email sent.') +
          ' This is NOT proof of delivery.');
      } else {
        setStatus('Queue preview unavailable (' + response.status + '). No email sent.');
      }
    } catch {
      setStatus('Queue preview request failed. No email sent.');
    } finally { busy = false; refresh(); }
  });

  sendVerifiedConfirmationButton.addEventListener('click', async () => {
    const token = tokenField.value.trim();
    const orderId = orderIdField.value.trim();
    if (busy || hasSent || !verifiedConfirmation ||
        verifiedConfirmation.orderId !== orderId ||
        verifiedConfirmation.token !== token) return;
    if (!window.confirm(
      'Send exactly ONE REAL order-confirmation email for database order #' + orderId +
      ' to the matching verified buyer email? The real COD order already exists. ' +
      'Zoho may incur delivery costs. This action cannot be undone, and there is NO automatic retry.'
    )) return;
    // Fail closed after ANY attempt, including timeout/unknown provider outcomes.
    busy = true;
    hasSent = true;
    verifiedConfirmation = null;
    refresh();
    setStatus('Submitting ONE verified order-confirmation email. Do not retry...');
    try {
      const {response, data} = await request('/api/outreach/zoho-confirmation-dispatch',
        {orderId: Number(orderId), confirmSend: true}, token);
      if(response.ok && data.accepted === true && data.sent === 1){
        setStatus('Zoho accepted ONE order confirmation for order #' + orderId +
          '. Check the buyer inbox / spam and the Orders mailbox Sent folder for delivery.' +
          ' Customer-side automatic email hook remains disabled. No second send.');
      } else {
        setStatus('Order confirmation NOT confirmed (' + response.status + '). ' +
          'Reason: ' + String(data.reason || data.error || 'UNKNOWN').slice(0,120) +
          '. Provider outcome may be uncertain. Check Zoho Sent + Supabase outbox before any retry.');
      }
    } catch {
      setStatus('Network timeout/error: provider outcome UNKNOWN. ' +
        'Do not retry. Check Zoho Sent and Supabase notification outbox.');
    } finally {
      tokenField.value = '';
      verifiedToken = null;
      verifiedOrdersToken = null;
      busy = false;
      refresh();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = tokenField.value.trim();
    const recipient = recipientField.value.trim();
    if (busy || hasSent || verifiedToken !== token || !recipientField.validity.valid || !recipient) return;
    busy = true; refresh();
    setStatus('Sending ONE test email through Zoho Mail...');
    try {
      const { response, data } = await request('/api/outreach/email', {
        messages: [{
          to: recipient,
          subject: 'Fashion Fussion — Zoho Mail API Test',
          mailFormat: 'html',
          content: '<p>Hello,</p><p>This is an authorized Zoho Mail API test from Fashion Fussion.</p><p>No order was created and no payment was made.</p><p>Fashion Fussion</p>',
        }],
      }, token);
      if (response.ok && data.sent === 1 && data.failed === 0) {
        hasSent = true;
        tokenField.value = ''; verifiedToken = null;
        setStatus('Success: Zoho Mail API accepted 1 test email for ' + recipient +
          '. Please check the Inbox and Spam folder to confirm arrival. No automatic notifications were enabled.');
      } else {
        const item = Array.isArray(data.results) ? data.results[0] : null;
        setStatus('Test send not confirmed (' + response.status + '). ' +
          String(data.error || item?.providerDescription || 'Provider did not confirm success').slice(0, 180) +
          '. Review Zoho config before retrying.');
      }
    } catch {
      setStatus('Network error; send outcome is UNKNOWN. Check the Zoho Sent folder and recipient inbox BEFORE retrying to avoid duplicates.');
      hasSent = true;
      tokenField.value = ''; verifiedToken = null;
    } finally { busy = false; refresh(); }
  });
  refresh();
})();

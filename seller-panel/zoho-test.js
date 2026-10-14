'use strict';
(() => {
  const tokenField = document.getElementById('token');
  const recipientField = document.getElementById('recipient');
  const result = document.getElementById('result');
  const verifyButton = document.getElementById('verify');
  const verifyOrdersButton = document.getElementById('verifyOrders');
  const sendOrdersButton = document.getElementById('sendOrders');
  const sendButton = document.getElementById('send');
  const form = document.getElementById('testForm');
  let verifiedToken = null;
  let verifiedOrdersToken = null;
  let busy = false;
  let hasSent = false;
  const setStatus = (text) => { result.textContent = text; };
  const refresh = () => {
    verifyButton.disabled = busy || hasSent;
    verifyOrdersButton.disabled = busy || hasSent;
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
  tokenField.addEventListener('input', () => { verifiedToken = null; verifiedOrdersToken = null; refresh(); });
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

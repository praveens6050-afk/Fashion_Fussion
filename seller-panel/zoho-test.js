'use strict';
(() => {
  const tokenField = document.getElementById('token');
  const recipientField = document.getElementById('recipient');
  const result = document.getElementById('result');
  const verifyButton = document.getElementById('verify');
  const verifyOrdersButton = document.getElementById('verifyOrders');
  const sendButton = document.getElementById('send');
  const form = document.getElementById('testForm');
  let verifiedToken = null;
  let busy = false;
  let hasSent = false;
  const setStatus = (text) => { result.textContent = text; };
  const refresh = () => {
    verifyButton.disabled = busy || hasSent;
    verifyOrdersButton.disabled = busy || hasSent;
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
  tokenField.addEventListener('input', () => { verifiedToken = null; refresh(); });
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
    verifiedToken = null; // Alias verification never enables the Sales test-send button.
    refresh();
    setStatus('Verifying orders@fashionfussion.in as an authorized sender alias. No email will be sent...');
    try {
      const { response, data } = await request('/api/outreach/zoho-verify', {
        dryRun: true, purpose: 'order_confirmation'
      }, token);
      if (response.ok && data.ready === true && data.fromAddressAuthorized === true) {
        setStatus('Success: orders@fashionfussion.in is authorized on the existing Zoho mailbox. No email sent. Automatic order emails remain disabled.');
      } else {
        setStatus('Order confirmation alias NOT verified (' + response.status + '). Issue: ' +
          String(data.issue || data.error || 'unknown').slice(0, 180) +
          '. Confirm the alias is enabled under Zoho Mail sender addresses. No email sent.');
      }
    } catch {
      setStatus('Could not reach the Zoho alias verifier. No email sent.');
    } finally { busy = false; refresh(); }
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

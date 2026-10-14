'use strict';
(function () {
  const recipient = 'ps4038267@gmail.com';
  const tokenInput = document.getElementById('token');
  const verifyButton = document.getElementById('verify');
  const sendButton = document.getElementById('send');
  const statusNode = document.getElementById('result');
  let verifiedToken = '';
  let sending = false;
  let sendAttempted = false;

  function status(message) { statusNode.textContent = message; }
  function setBusy(busy) {
    verifyButton.disabled = busy || sendAttempted;
    sendButton.disabled = busy || sending || sendAttempted || !verifiedToken;
  }
  tokenInput.addEventListener('input', () => {
    verifiedToken = '';
    sendButton.disabled = true;
    if (!sendAttempted) status('Token changed. Verify the Zoho connection again.');
  });

  async function callProtected(path, token, body) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { httpStatus: response.status, payload: json };
  }

  verifyButton.addEventListener('click', async () => {
    if (sendAttempted) return;
    const token = tokenInput.value.trim();
    if (!token) { status('Enter the OUTREACH_API_TOKEN first.'); return; }
    verifiedToken = '';
    setBusy(true);
    status('Checking Zoho OAuth, mailbox and sender settings (no message will be sent)...');
    try {
      const result = await callProtected('/api/outreach/zoho-verify', token, { dryRun: true });
      if (result.httpStatus === 401) {
        status('Unauthorized (401). The internal API token did not match OUTREACH_API_TOKEN.');
      } else if (result.payload.ready === true && result.httpStatus === 200) {
        verifiedToken = token;
        status('Zoho OAuth, account ID and from-address checks passed. No email sent yet. You may send ONE test message.');
      } else {
        const reason = String(result.payload.issue || result.payload.error || ('HTTP ' + result.httpStatus));
        const missing = Array.isArray(result.payload.missingConfiguration)
          ? ' Missing: ' + result.payload.missingConfiguration.join(', ') : '';
        status('Zoho is not ready: ' + reason + '.' + missing + ' No email sent.');
      }
    } catch {
      status('Verification request failed. Confirm this page is on seller.fashionfussion.in and the endpoint is deployed. No email sent.');
    } finally {
      setBusy(false);
    }
  });

  sendButton.addEventListener('click', async () => {
    if (sending || sendAttempted || !verifiedToken) return;
    if (tokenInput.value.trim() !== verifiedToken) {
      verifiedToken = '';
      setBusy(false);
      status('Token changed; verify again.');
      return;
    }
    const approved = window.confirm('Send exactly ONE test email from Fashion Fussion Zoho Mail to ' + recipient + '?');
    if (!approved) return;
    sending = true;
    sendAttempted = true; // Fail closed, including unknown provider/network outcomes.
    setBusy(true);
    status('Submitting one test email to Zoho. Do not reload or click again.');
    const timestamp = new Date().toISOString();
    const body = {
      messages: [{
        to: recipient,
        subject: '[TEST] Fashion Fussion Zoho Mail - ' + timestamp,
        mailFormat: 'html',
        content: '<html><body><h2>Fashion Fussion Zoho Mail Test</h2>'
          + '<p>This is a one-time manual integration test from the Fashion Fussion seller backend.</p>'
          + '<p>Test reference: ' + timestamp + '</p>'
          + '<p>No order, payment, or marketing campaign was triggered.</p></body></html>',
      }],
    };
    try {
      const result = await callProtected('/api/outreach/email', verifiedToken, body);
      const first = Array.isArray(result.payload.results) ? result.payload.results[0] : null;
      if (result.httpStatus === 200 && result.payload.sent === 1 && first?.ok === true) {
        status('Zoho accepted the test email request (HTTP 200). Recipient: ' + recipient
          + '. Check Gmail Inbox, Promotions and Spam. Acceptance does not guarantee delivery.'
          + ' Test reference: ' + timestamp);
      } else {
        status('Zoho did not confirm an accepted send. HTTP ' + result.httpStatus
          + '. Details: ' + String(result.payload.error || first?.providerDescription || 'Unknown provider response')
          + '. Check Zoho Sent folder and recipient inbox BEFORE trying again.');
      }
    } catch {
      status('Network error / uncertain sending outcome. Check Zoho Sent folder and recipient inbox before any retry.');
    } finally {
      verifiedToken = '';
      tokenInput.value = '';
      sending = false;
      setBusy(false);
    }
  });
}());

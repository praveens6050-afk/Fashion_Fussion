'use strict';
// Operator-only GETs to same-origin private endpoints. No third-party JS,
// local/session storage, POSTs, Meta sends or persistent credentials.
(() => {
  const token = document.getElementById('token');
  const form = document.getElementById('readinessForm');
  const check = document.getElementById('check');
  const status = document.getElementById('status');
  const health = document.getElementById('health');
  const meta = document.getElementById('meta');
  const roles = document.getElementById('roles');

  async function readOnlyGet(path, bearer) {
    const response = await fetch(path, {
      method: 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: {Authorization: 'Bearer ' + bearer, Accept: 'application/json'}
    });
    const data = await response.json().catch(() => ({error: 'Invalid server response'}));
    if (!response.ok) {
      // Raw server/provider errors are not shown to an operator.
      return {httpStatus:response.status,ready:false,
        issue: String(data.issue || data.error || 'READ_UNAVAILABLE').slice(0,90)};
    }
    return data;
  }

  function show(element, result) {
    element.textContent = JSON.stringify(result, null, 2);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (check.disabled) return;
    const bearer = token.value.trim();
    if (!bearer) {status.textContent = 'Enter the existing OUTREACH_API_TOKEN.';return;}
    token.value = '';
    check.disabled = true;
    status.textContent = 'Checking two read-only endpoints…';
    health.textContent = 'Checking…';
    meta.textContent = 'Checking…';
    roles.textContent = 'Checking…';
    try {
      const results = await Promise.allSettled([
        readOnlyGet('/api/outreach/whatsapp-health',bearer),
        readOnlyGet('/api/outreach/whatsapp-meta-readiness',bearer),
        readOnlyGet('/api/outreach/whatsapp-roles-readiness',bearer)
      ]);
      const output=results.map(r=>r.status==='fulfilled'?r.value:{ready:false,issue:'NETWORK_UNAVAILABLE'});
      show(health, output[0]);
      show(meta, output[1]);
      show(roles, output[2]);
      status.textContent = output[0].readOnly && output[1].ready
        ? 'Preflight checks passed; actual sending remains subject to separate launch approval.'
        : 'One or more readiness checks require attention. No message was sent.';
    } finally {
      check.disabled = false;
    }
  });
  document.getElementById('clear').addEventListener('click', () => {
    token.value = '';
    health.textContent = 'Not checked';
    meta.textContent = 'Not checked';
    roles.textContent = 'Not checked';
    status.textContent = 'Cleared. No messages sent.';
  });
})();

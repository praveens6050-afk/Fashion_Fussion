import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { onRequestPost } from '../functions/api/outreach/zoho-verify.js';

globalThis.crypto ||= webcrypto;

const token = 'safe-diagnostic-test-token-'.padEnd(48, 'x');
const env = {
  OUTREACH_API_TOKEN: token,
  ZOHO_ORDERS_CLIENT_ID: 'synthetic-client-id',
  ZOHO_ORDERS_CLIENT_SECRET: 'synthetic-client-secret',
  ZOHO_ORDERS_REFRESH_TOKEN: 'synthetic-refresh-token',
  ZOHO_ORDERS_MAIL_ACCOUNT_ID: 'synthetic-account-id'
};
function request() {
  return new Request('https://seller.fashionfussion.in/api/outreach/zoho-verify', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun: true, purpose: 'order_confirmation' })
  });
}
test('returns only the sanitized Zoho OAuth error code without sending mail or leaking provider details', async t => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      error: 'invalid_code',
      error_description: 'SENSITIVE PROVIDER DETAIL MUST NOT BE RETURNED',
      access_token: 'NEVER-RETURN-THIS-TOKEN'
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  const response = await onRequestPost({ request: request(), env });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.issue, 'ZOHO_OAUTH_REFRESH_FAILED');
  assert.equal(body.providerErrorCode, 'invalid_code');
  assert.equal(body.sent, 0);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(body).includes('SENSITIVE PROVIDER DETAIL'), false);
  assert.equal(JSON.stringify(body).includes('NEVER-RETURN-THIS-TOKEN'), false);
});

test('replaces malformed provider error values with UNKNOWN', async t => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'invalid code with secrets'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  t.after(() => { globalThis.fetch = previousFetch; });

  const response = await onRequestPost({ request: request(), env });
  const body = await response.json();
  assert.equal(body.providerErrorCode, 'UNKNOWN');
  assert.equal(body.sent, 0);
});

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const webhook = fs.readFileSync(path.join(__dirname, 'api', 'razorpay-webhook.js'), 'utf8');

assert.ok(
  webhook.includes("retryable: claim.reason === 'in_progress'"),
  'Concurrent payment recovery claims must remain retryable instead of being acknowledged as complete'
);
assert.ok(
  webhook.includes('email_failed: true') && webhook.includes('retryable: true'),
  'Transient recovery-email failures must be marked retryable'
);
assert.ok(
  webhook.includes('result?.retryable ? 503 : 200'),
  'Retryable webhook processing must return non-2xx so Razorpay can redeliver the event'
);
assert.ok(
  webhook.includes("reason: 'payment_window_expired'"),
  'Expired payment windows must stop recovery retries'
);
assert.ok(
  webhook.includes("reason: 'zoho_not_configured'"),
  'Permanent Zoho configuration errors must remain explicitly classified'
);
assert.ok(
  webhook.includes("existing?.status === 'sent'"),
  'Recovery notifications must deduplicate successfully sent messages'
);

console.log('Payment recovery webhook retry contract passed');

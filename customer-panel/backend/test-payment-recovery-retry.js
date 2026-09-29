const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');
const path = require('path');

const webhookPath = path.join(__dirname, 'api', 'razorpay-webhook.js');
const originalLoad = Module._load;
const originalFetch = global.fetch;
const webhookSecret = 'payment-recovery-test-secret';

let sendMode = 'fail';
let sendCalls = 0;
let notification = null;
let notificationId = 1;

const order = {
  id: 9001,
  user_id: '11111111-1111-1111-1111-111111111111',
  display_order_id: 'FF-TEST-9001',
  total_amount: 100,
  currency: 'INR',
  status: 'created',
  payment_method: 'prepaid',
  razorpay_payment_id: null,
  customer_name: 'Recovery Test',
  customer_email: 'customer@example.com',
  items: [],
  created_at: new Date(Date.now() - 60 * 1000).toISOString()
};

function fakeResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

global.fetch = async (url, options = {}) => {
  const target = String(url);
  const method = String(options.method || 'GET').toUpperCase();

  if (target.includes('/rest/v1/orders?razorpay_order_id=')) {
    return fakeResponse([order]);
  }

  if (target.includes('/rest/v1/payment_recovery_notifications?event_type=eq.payment_failed')) {
    return fakeResponse(notification ? [notification] : []);
  }

  if (target.endsWith('/rest/v1/payment_recovery_notifications') && method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    notification = { id: notificationId++, ...body };
    return fakeResponse([notification]);
  }

  if (target.includes('/rest/v1/payment_recovery_notifications?id=eq.') && method === 'PATCH') {
    const body = JSON.parse(options.body || '{}');
    notification = { ...notification, ...body };
    return fakeResponse([notification]);
  }

  throw new Error(`Unexpected test fetch: ${method} ${target}`);
};

const libStub = {
  WEBHOOK_SECRET: webhookSecret,
  SUPABASE_URL: 'https://example.supabase.co',
  serverHeaders: { Authorization: 'Bearer test-service-role' },
  json(req, res, status, payload) {
    res.statusCode = status;
    res.body = payload;
    return { status, payload };
  },
  async readRawBody(req) {
    return req.raw;
  },
  safeEqualText(a, b) {
    return String(a) === String(b);
  },
  roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
};

const zohoStub = {
  isZohoMailConfigured() {
    return true;
  },
  async sendZohoMail() {
    sendCalls += 1;
    if (sendMode === 'fail') throw new Error('temporary Zoho outage');
    return { messageId: 'zoho-test-message-1' };
  }
};

const magicLinkStub = {
  async getConfirmedAuthEmail() {
    return 'customer@example.com';
  },
  async generatePaymentRetryMagicLink() {
    return 'https://fashionfussion.in/order-details.html?id=9001&payment=1&autopay=1';
  }
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename === webhookPath) {
    if (request === '../lib') return libStub;
    if (request === '../zoho-mail') return zohoStub;
    if (request === '../supabase-magic-link') return magicLinkStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[require.resolve(webhookPath)];
const razorpayWebhook = require(webhookPath);

function failedPaymentEvent() {
  return {
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_recovery_1',
          order_id: 'order_test_recovery_1',
          status: 'failed',
          amount: 10000
        }
      }
    }
  };
}

async function invoke(event) {
  const raw = Buffer.from(JSON.stringify(event));
  const signature = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
  const req = {
    method: 'POST',
    headers: { 'x-razorpay-signature': signature },
    raw
  };
  const res = {};
  await razorpayWebhook(req, res);
  return res;
}

(async () => {
  const first = await invoke(failedPaymentEvent());
  assert.strictEqual(first.statusCode, 503, 'Transient Zoho failure must request Razorpay redelivery');
  assert.strictEqual(first.body.email_failed, true);
  assert.strictEqual(first.body.retryable, true);
  assert.strictEqual(notification.status, 'failed');
  assert.strictEqual(notification.attempt_count, 1);
  assert.strictEqual(sendCalls, 1);

  sendMode = 'success';
  const second = await invoke(failedPaymentEvent());
  assert.strictEqual(second.statusCode, 200, 'Successful retry must acknowledge the webhook');
  assert.strictEqual(second.body.email_sent, true);
  assert.strictEqual(second.body.passwordless_retry, true);
  assert.strictEqual(notification.status, 'sent');
  assert.strictEqual(notification.attempt_count, 2);
  assert.strictEqual(notification.provider_message_id, 'zoho-test-message-1');
  assert.strictEqual(sendCalls, 2);

  const third = await invoke(failedPaymentEvent());
  assert.strictEqual(third.statusCode, 200, 'Duplicate webhook after successful email must be acknowledged');
  assert.strictEqual(third.body.email_deduplicated, true);
  assert.strictEqual(third.body.reason, 'already_sent');
  assert.strictEqual(sendCalls, 2, 'Duplicate webhook must not send a second recovery email');

  console.log('Payment recovery webhook runtime retry/dedupe test passed');
})()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    delete require.cache[require.resolve(webhookPath)];
  });

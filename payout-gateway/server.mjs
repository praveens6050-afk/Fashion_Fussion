import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const GATEWAY_TOKEN = String(process.env.GATEWAY_TOKEN || '').trim();
const RAZORPAYX_KEY_ID = String(process.env.RAZORPAYX_KEY_ID || '').trim();
const RAZORPAYX_KEY_SECRET = String(process.env.RAZORPAYX_KEY_SECRET || '').trim();
const RAZORPAYX_ACCOUNT_NUMBER = String(process.env.RAZORPAYX_ACCOUNT_NUMBER || '').trim();
const MAX_BODY_BYTES = 24 * 1024;
const MAX_PAYOUT_PAISE = Number(process.env.MAX_PAYOUT_PAISE || 50000000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(body));
}

function ready() {
  return Boolean(GATEWAY_TOKEN && RAZORPAYX_KEY_ID && RAZORPAYX_KEY_SECRET && RAZORPAYX_ACCOUNT_NUMBER);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') && safeEqual(header.slice(7).trim(), GATEWAY_TOKEN);
}

async function readJson(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) throw Object.assign(new Error('Content-Type must be application/json'), { status: 415 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

function basicAuth() {
  return 'Basic ' + Buffer.from(`${RAZORPAYX_KEY_ID}:${RAZORPAYX_KEY_SECRET}`).toString('base64');
}

async function razorpay(path, { method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth(),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.description || data?.error?.reason || data?.message || `RazorpayX request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status >= 500 ? 502 : 400;
    error.providerStatus = response.status;
    throw error;
  }
  return data;
}

function cleanText(value, max = 100) {
  const text = String(value || '').trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw Object.assign(new Error('Invalid text field'), { status: 400 });
  return text;
}

function optionalText(value, max = 120) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw Object.assign(new Error('Invalid optional text field'), { status: 400 });
  return text;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function createFundAccount(input) {
  if (!validUuid(input.seller_id)) throw Object.assign(new Error('Invalid seller id'), { status: 400 });
  const name = cleanText(input.name, 50);
  const email = optionalText(input.email, 120);
  const contact = String(input.contact || '').replace(/\D/g, '');
  if (contact && !/^\d{10,15}$/.test(contact)) throw Object.assign(new Error('Invalid seller contact number'), { status: 400 });
  const bank = input.bank_account || {};
  const ifsc = String(bank.ifsc || '').trim().toUpperCase();
  const accountNumber = String(bank.account_number || '').replace(/\D/g, '');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw Object.assign(new Error('Invalid IFSC'), { status: 400 });
  if (!/^\d{9,18}$/.test(accountNumber)) throw Object.assign(new Error('Invalid bank account number'), { status: 400 });

  const contactEntity = await razorpay('/v1/contacts', {
    body: {
      name,
      ...(email ? { email } : {}),
      ...(contact ? { contact } : {}),
      type: 'vendor',
      reference_id: `ff-${input.seller_id}`
    }
  });

  if (!contactEntity?.id) throw Object.assign(new Error('RazorpayX contact id missing'), { status: 502 });

  const fundAccount = await razorpay('/v1/fund_accounts', {
    body: {
      contact_id: contactEntity.id,
      account_type: 'bank_account',
      bank_account: { name, ifsc, account_number: accountNumber }
    }
  });
  if (!fundAccount?.id) throw Object.assign(new Error('RazorpayX fund account id missing'), { status: 502 });

  return {
    ok: true,
    provider: 'razorpayx',
    contact_id: contactEntity.id,
    fund_account_id: fundAccount.id
  };
}

async function createPayout(input, req) {
  const settlementId = Number(input.settlement_id);
  const amount = Number(input.amount);
  const fundAccountId = String(input.fund_account_id || '').trim();
  const mode = String(input.mode || 'IMPS').trim().toUpperCase();
  const idempotencyKey = String(req.headers['idempotency-key'] || req.headers['x-payout-idempotency'] || '').trim();

  if (!Number.isSafeInteger(settlementId) || settlementId < 1) throw Object.assign(new Error('Invalid settlement id'), { status: 400 });
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_PAYOUT_PAISE) throw Object.assign(new Error('Invalid payout amount'), { status: 400 });
  if (!/^fa_[A-Za-z0-9]+$/.test(fundAccountId)) throw Object.assign(new Error('Invalid fund account id'), { status: 400 });
  if (!['IMPS', 'NEFT', 'RTGS'].includes(mode)) throw Object.assign(new Error('Unsupported payout mode'), { status: 400 });
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(idempotencyKey)) throw Object.assign(new Error('Valid idempotency key is required'), { status: 400 });

  const payout = await razorpay('/v1/payouts', {
    headers: { 'X-Payout-Idempotency': idempotencyKey },
    body: {
      account_number: RAZORPAYX_ACCOUNT_NUMBER,
      fund_account_id: fundAccountId,
      amount,
      currency: 'INR',
      mode,
      purpose: 'payout',
      queue_if_low_balance: false,
      reference_id: `ff-settlement-${settlementId}`,
      narration: 'Fashion Fussion seller settlement'
    }
  });

  return payout;
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/readyz') return json(res, ready() ? 200 : 503, { ready: ready() });
  if (req.url !== '/v1/gateway') return json(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!ready()) return json(res, 503, { error: 'Payout gateway is not configured' });
  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });

  try {
    const body = await readJson(req);
    const operation = String(body.operation || '').trim();
    if (operation === 'create_fund_account') return json(res, 200, await createFundAccount(body));
    if (operation === 'create_payout') return json(res, 200, await createPayout(body, req));
    return json(res, 400, { error: 'Unsupported gateway operation' });
  } catch (error) {
    const status = Number(error?.status) || (error?.name === 'TimeoutError' ? 504 : 500);
    console.error(JSON.stringify({
      level: 'error',
      message: 'gateway request failed',
      status,
      provider_status: error?.providerStatus || null,
      error: String(error?.message || 'unknown error')
    }));
    return json(res, status, { error: error?.message || 'Gateway request failed' });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(JSON.stringify({ level: 'error', message: 'unhandled gateway error', error: String(error?.message || error) }));
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ level: 'info', message: 'payout gateway started', host: HOST, port: PORT, ready: ready() }));
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

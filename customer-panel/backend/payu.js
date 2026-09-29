const crypto = require('crypto');
const { safeEqualText } = require('./lib');

const PAYU_MERCHANT_KEY = String(process.env.PAYU_MERCHANT_KEY || '').trim();
const PAYU_SALT = String(process.env.PAYU_SALT || '').trim();
const PAYU_ENV = String(process.env.PAYU_ENV || 'production').trim().toLowerCase();
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || 'https://fashionfussion.in').trim().replace(/\/+$/, '');
const PAYU_PAYMENT_URL = PAYU_ENV === 'test' ? 'https://test.payu.in/_payment' : 'https://secure.payu.in/_payment';
const PAYU_VERIFY_URL = PAYU_ENV === 'test'
  ? 'https://test.payu.in/merchant/postservice.php?form=2'
  : 'https://info.payu.in/merchant/postservice.php?form=2';

function sha512(value) {
  return crypto.createHash('sha512').update(String(value), 'utf8').digest('hex');
}

function isPayUConfigured() {
  return Boolean(PAYU_MERCHANT_KEY && PAYU_SALT && PUBLIC_SITE_URL);
}

function assertPayUConfigured() {
  if (!PAYU_MERCHANT_KEY || !PAYU_SALT) throw new Error('PayU server credentials are not configured');
  if (!/^https:\/\//i.test(PUBLIC_SITE_URL)) throw new Error('PUBLIC_SITE_URL must be an HTTPS URL');
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid PayU payment amount');
  return amount.toFixed(2);
}

function txnidForOrder(orderId) {
  const id = String(orderId || '').replace(/[^A-Za-z0-9]/g, '');
  if (!id) throw new Error('Cannot create PayU transaction ID');
  const txnid = 'FF' + id;
  if (txnid.length > 25) throw new Error('PayU transaction ID is too long');
  return txnid;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10) throw new Error('A valid mobile number is required for PayU');
  return digits.slice(-10);
}

function firstName(value) {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Customer name is required for PayU');
  return clean.split(' ')[0].slice(0, 60);
}

function paymentRequestHash(fields) {
  assertPayUConfigured();
  const sequence = [
    fields.key,
    fields.txnid,
    fields.amount,
    fields.productinfo,
    fields.firstname,
    fields.email,
    fields.udf1 || '',
    fields.udf2 || '',
    fields.udf3 || '',
    fields.udf4 || '',
    fields.udf5 || ''
  ].join('|') + '||||||' + PAYU_SALT;
  return sha512(sequence);
}

function buildHostedCheckout(order) {
  assertPayUConfigured();
  const email = String(order.customer_email || '').trim();
  if (!email || !email.includes('@')) throw new Error('A valid customer email is required for PayU');
  const txnid = String(order.payu_txnid || txnidForOrder(order.id));
  const address = order.shipping_address && typeof order.shipping_address === 'object' ? order.shipping_address : {};
  const productinfo = ('Fashion Fussion Order ' + String(order.display_order_id || order.id)).slice(0, 100);
  const fields = {
    key: PAYU_MERCHANT_KEY,
    txnid,
    amount: formatAmount(order.total_amount),
    productinfo,
    firstname: firstName(order.customer_name),
    email,
    phone: normalizePhone(order.customer_phone),
    surl: PUBLIC_SITE_URL + '/api/payu-callback',
    furl: PUBLIC_SITE_URL + '/api/payu-callback',
    udf1: String(order.id),
    udf2: '',
    udf3: '',
    udf4: '',
    udf5: String(order.display_order_id || order.id).slice(0, 255),
    address1: String(address.address_line1 || '').slice(0, 100),
    address2: String(address.address_line2 || '').slice(0, 100),
    city: String(address.city || '').slice(0, 50),
    state: String(address.state || '').slice(0, 50),
    country: String(address.country || 'India').slice(0, 50),
    zipcode: String(address.postal_code || '').slice(0, 20)
  };
  fields.hash = paymentRequestHash(fields);
  return {
    provider: 'payu',
    method: 'POST',
    action: PAYU_PAYMENT_URL,
    fields
  };
}

function responseHashSequence(payload) {
  const status = String(payload.status || '');
  const sequence = [
    PAYU_SALT,
    status,
    '', '', '', '', '', '',
    String(payload.udf5 || ''),
    String(payload.udf4 || ''),
    String(payload.udf3 || ''),
    String(payload.udf2 || ''),
    String(payload.udf1 || ''),
    String(payload.email || ''),
    String(payload.firstname || ''),
    String(payload.productinfo || ''),
    String(payload.amount || ''),
    String(payload.txnid || ''),
    String(payload.key || '')
  ].join('|');
  const additional = payload.additionalCharges ?? payload.additional_charges;
  return additional == null || additional === '' ? sequence : String(additional) + '|' + sequence;
}

function verifyResponseHash(payload) {
  assertPayUConfigured();
  const provided = String(payload.hash || '').trim().toLowerCase();
  if (!provided) return false;
  return safeEqualText(sha512(responseHashSequence(payload)), provided);
}

async function verifyPayment(txnid) {
  assertPayUConfigured();
  const command = 'verify_payment';
  const id = String(txnid || '').trim();
  if (!id) throw new Error('PayU transaction ID is required');
  const body = new URLSearchParams({
    key: PAYU_MERCHANT_KEY,
    command,
    var1: id,
    hash: sha512(PAYU_MERCHANT_KEY + '|' + command + '|' + id + '|' + PAYU_SALT)
  });
  const response = await fetch(PAYU_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') throw new Error('Could not verify payment with PayU');
  return data;
}

function transactionFromVerification(data, txnid) {
  const details = data && typeof data.transaction_details === 'object' ? data.transaction_details : null;
  if (!details) return null;
  return details[String(txnid)] || details[Object.keys(details)[0]] || null;
}

function verifiedSuccess(detail) {
  return String(detail?.status || '').toLowerCase() === 'success';
}

module.exports = {
  PAYU_MERCHANT_KEY,
  PAYU_ENV,
  PAYU_PAYMENT_URL,
  PAYU_VERIFY_URL,
  PUBLIC_SITE_URL,
  isPayUConfigured,
  assertPayUConfigured,
  formatAmount,
  txnidForOrder,
  buildHostedCheckout,
  verifyResponseHash,
  verifyPayment,
  transactionFromVerification,
  verifiedSuccess
};

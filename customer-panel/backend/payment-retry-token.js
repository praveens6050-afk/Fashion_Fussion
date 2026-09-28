'use strict';

const crypto = require('crypto');

const MAX_PAYMENT_AGE_MS = 60 * 60 * 1000;
const RETRY_TOKEN_BYTES = 32;

function generateRetryToken() {
  return crypto.randomBytes(RETRY_TOKEN_BYTES).toString('base64url');
}

function hashRetryToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function isRetryTokenShape(token) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token || ''));
}

function retryExpiryForOrder(order) {
  const createdAt = new Date(order?.created_at || '').getTime();
  if (!Number.isFinite(createdAt)) return null;
  return new Date(createdAt + MAX_PAYMENT_AGE_MS);
}

function isPaymentWindowActive(order, now = Date.now()) {
  const expiresAt = retryExpiryForOrder(order);
  return Boolean(expiresAt && expiresAt.getTime() > now);
}

module.exports = {
  MAX_PAYMENT_AGE_MS,
  generateRetryToken,
  hashRetryToken,
  isRetryTokenShape,
  retryExpiryForOrder,
  isPaymentWindowActive
};

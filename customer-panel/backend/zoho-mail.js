'use strict';

const ZOHO_CLIENT_ID = String(process.env.ZOHO_CLIENT_ID || '').trim();
const ZOHO_CLIENT_SECRET = String(process.env.ZOHO_CLIENT_SECRET || '').trim();
const ZOHO_REFRESH_TOKEN = String(process.env.ZOHO_REFRESH_TOKEN || '').trim();
const ZOHO_ACCOUNT_ID = String(process.env.ZOHO_ACCOUNT_ID || '').trim();
const ZOHO_FROM_EMAIL = String(process.env.ZOHO_FROM_EMAIL || '').trim();
const ZOHO_ACCOUNTS_BASE = String(process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.in').replace(/\/+$/, '');
const ZOHO_MAIL_BASE = String(process.env.ZOHO_MAIL_BASE || 'https://mail.zoho.in').replace(/\/+$/, '');

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

function isZohoMailConfigured() {
  return Boolean(
    ZOHO_CLIENT_ID &&
    ZOHO_CLIENT_SECRET &&
    ZOHO_REFRESH_TOKEN &&
    ZOHO_ACCOUNT_ID &&
    ZOHO_FROM_EMAIL
  );
}

async function getAccessToken() {
  if (!isZohoMailConfigured()) {
    const error = new Error('Zoho Mail is not configured');
    error.code = 'ZOHO_NOT_CONFIGURED';
    throw error;
  }

  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60 * 1000) {
    return cachedAccessToken;
  }

  const body = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });

  const response = await fetch(ZOHO_ACCOUNTS_BASE + '/oauth/v2/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    const error = new Error(data?.error || 'Could not refresh Zoho Mail access token');
    error.code = 'ZOHO_TOKEN_FAILED';
    throw error;
  }

  cachedAccessToken = String(data.access_token);
  const expiresInSeconds = Math.max(60, Number(data.expires_in || 3600));
  cachedAccessTokenExpiresAt = now + expiresInSeconds * 1000;
  return cachedAccessToken;
}

async function sendZohoMail({ to, subject, html }) {
  const recipient = String(to || '').trim();
  if (!recipient || !recipient.includes('@')) throw new Error('A valid email recipient is required');
  if (!String(subject || '').trim()) throw new Error('Email subject is required');
  if (!String(html || '').trim()) throw new Error('Email content is required');

  const accessToken = await getAccessToken();
  const response = await fetch(
    ZOHO_MAIL_BASE + '/api/accounts/' + encodeURIComponent(ZOHO_ACCOUNT_ID) + '/messages',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Zoho-oauthtoken ' + accessToken
      },
      body: JSON.stringify({
        fromAddress: ZOHO_FROM_EMAIL,
        toAddress: recipient,
        subject: String(subject),
        content: String(html),
        mailFormat: 'html',
        encoding: 'UTF-8'
      })
    }
  );

  const data = await response.json().catch(() => ({}));
  const apiCode = Number(data?.status?.code || response.status);
  if (!response.ok || apiCode >= 400) {
    const detail = data?.data?.moreInfo || data?.status?.description || 'Zoho Mail send failed';
    const error = new Error(String(detail));
    error.code = 'ZOHO_SEND_FAILED';
    error.status = response.status;
    throw error;
  }

  return {
    messageId: data?.data?.messageId ? String(data.data.messageId) : null,
    mailId: data?.data?.mailId ? String(data.data.mailId) : null
  };
}

module.exports = {
  isZohoMailConfigured,
  sendZohoMail
};

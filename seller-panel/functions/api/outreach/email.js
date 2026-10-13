const MAX_BATCH = 25;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value || '');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function authorized(request, env) {
  if (!env.OUTREACH_API_TOKEN) return false;
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [a, b] = await Promise.all([digest(supplied), digest(env.OUTREACH_API_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function requiredEnv(env) {
  return [
    'ZOHO_CLIENT_ID',
    'ZOHO_CLIENT_SECRET',
    'ZOHO_REFRESH_TOKEN',
    'ZOHO_MAIL_ACCOUNT_ID',
    'ZOHO_MAIL_FROM_ADDRESS',
  ].filter((key) => !env[key]);
}

function validateMessage(message, index) {
  if (!message || typeof message !== 'object') return `messages[${index}] must be an object`;
  if (!EMAIL_RE.test(String(message.to || ''))) return `messages[${index}].to is invalid`;
  if (!String(message.subject || '').trim()) return `messages[${index}].subject is required`;
  if (String(message.subject).length > 180) return `messages[${index}].subject is too long`;
  if (!String(message.content || '').trim()) return `messages[${index}].content is required`;
  if (String(message.content).length > 40000) return `messages[${index}].content is too long`;
  if (message.mailFormat && !['html', 'plaintext'].includes(message.mailFormat)) {
    return `messages[${index}].mailFormat must be html or plaintext`;
  }
  return null;
}

async function getZohoAccessToken(env) {
  const accountsBase = (env.ZOHO_ACCOUNTS_BASE_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
  const url = new URL(`${accountsBase}/oauth/v2/token`);
  url.searchParams.set('refresh_token', env.ZOHO_REFRESH_TOKEN);
  url.searchParams.set('client_id', env.ZOHO_CLIENT_ID);
  url.searchParams.set('client_secret', env.ZOHO_CLIENT_SECRET);
  url.searchParams.set('grant_type', 'refresh_token');

  const response = await fetch(url.toString(), { method: 'POST' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Zoho OAuth refresh failed (${response.status})`);
  }
  return payload.access_token;
}

async function sendZohoMail(env, accessToken, message) {
  const mailBase = (env.ZOHO_MAIL_BASE_URL || 'https://mail.zoho.in').replace(/\/$/, '');
  const endpoint = `${mailBase}/api/accounts/${encodeURIComponent(env.ZOHO_MAIL_ACCOUNT_ID)}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Zoho-oauthtoken ${accessToken}`,
    },
    body: JSON.stringify({
      fromAddress: env.ZOHO_MAIL_FROM_ADDRESS,
      toAddress: String(message.to).trim(),
      subject: String(message.subject).trim(),
      content: String(message.content),
      mailFormat: message.mailFormat || 'html',
      askReceipt: 'no',
    }),
  });

  const payload = await response.json().catch(() => null);
  const providerCode = payload?.status?.code ?? null;
  const providerDescription = payload?.status?.description ?? null;
  return {
    ok: response.ok && (providerCode === null || Number(providerCode) === 200),
    httpStatus: response.status,
    providerCode,
    providerDescription,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await authorized(request, env))) return json({ error: 'Unauthorized' }, 401);

  const missing = requiredEnv(env);
  if (missing.length) return json({ error: 'Zoho outreach is not configured', missing }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) return json({ error: 'messages must contain at least one email' }, 400);
  if (messages.length > MAX_BATCH) return json({ error: `Maximum ${MAX_BATCH} emails per request` }, 400);

  for (let i = 0; i < messages.length; i += 1) {
    const error = validateMessage(messages[i], i);
    if (error) return json({ error }, 400);
  }

  let accessToken;
  try {
    accessToken = await getZohoAccessToken(env);
  } catch (error) {
    console.error('Zoho outreach OAuth failed', error?.message || String(error));
    return json({ error: 'Zoho authentication failed' }, 502);
  }

  const results = [];
  for (const message of messages) {
    try {
      const result = await sendZohoMail(env, accessToken, message);
      results.push({ to: message.to, ...result });
    } catch (error) {
      console.error('Zoho outreach send failed', error?.message || String(error));
      results.push({ to: message.to, ok: false, httpStatus: null, providerCode: null, providerDescription: 'Network error' });
    }
  }

  const sent = results.filter((item) => item.ok).length;
  return json({ sent, failed: results.length - sent, results }, sent ? 200 : 502);
}

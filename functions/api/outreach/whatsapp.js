const MAX_BATCH = 25;
const PHONE_RE = /^\d{8,15}$/;

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
  return ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_GRAPH_VERSION']
    .filter((key) => !env[key]);
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function validateMessage(message, index) {
  if (!message || typeof message !== 'object') return `messages[${index}] must be an object`;
  const to = normalizePhone(message.to);
  if (!PHONE_RE.test(to)) return `messages[${index}].to must be an international phone number`;
  if (!String(message.templateName || '').trim()) return `messages[${index}].templateName is required`;
  if (String(message.templateName).length > 512) return `messages[${index}].templateName is too long`;
  if (message.components && !Array.isArray(message.components)) return `messages[${index}].components must be an array`;
  return null;
}

async function sendTemplate(env, message) {
  const version = String(env.WHATSAPP_GRAPH_VERSION).replace(/^\//, '');
  const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(message.to),
    type: 'template',
    template: {
      name: String(message.templateName).trim(),
      language: { code: message.languageCode || 'en' },
      ...(message.components?.length ? { components: message.components } : {}),
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    httpStatus: response.status,
    messageId: result?.messages?.[0]?.id || null,
    errorCode: result?.error?.code || null,
    errorMessage: result?.error?.message || null,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await authorized(request, env))) return json({ error: 'Unauthorized' }, 401);

  const missing = requiredEnv(env);
  if (missing.length) return json({ error: 'WhatsApp outreach is not configured', missing }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) return json({ error: 'messages must contain at least one template message' }, 400);
  if (messages.length > MAX_BATCH) return json({ error: `Maximum ${MAX_BATCH} messages per request` }, 400);

  for (let i = 0; i < messages.length; i += 1) {
    const error = validateMessage(messages[i], i);
    if (error) return json({ error }, 400);
  }

  const results = [];
  for (const message of messages) {
    try {
      const result = await sendTemplate(env, message);
      results.push({ to: normalizePhone(message.to), ...result });
    } catch (error) {
      console.error('WhatsApp outreach send failed', error?.message || String(error));
      results.push({ to: normalizePhone(message.to), ok: false, httpStatus: null, messageId: null, errorCode: null, errorMessage: 'Network error' });
    }
  }

  const sent = results.filter((item) => item.ok).length;
  return json({ sent, failed: results.length - sent, results }, sent ? 200 : 502);
}

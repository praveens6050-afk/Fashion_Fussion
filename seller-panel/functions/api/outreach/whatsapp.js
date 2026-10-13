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

function validPhoneNumberId(env) {
  return /^[0-9]{13,25}$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim());
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function validateMessage(message, index) {
  if (!message || typeof message !== 'object') return `messages[${index}] must be an object`;
  const to = normalizePhone(message.to);
  if (!PHONE_RE.test(to)) return `messages[${index}].to must be an international phone number`;
  if (!/^[a-z0-9_]{1,512}$/.test(String(message.templateName || '').trim())) return `messages[${index}].templateName must be a valid approved WhatsApp template name`;
  if (message.components && !Array.isArray(message.components)) return `messages[${index}].components must be an array`;
  return null;
}

function consentError(message, index) {
  const consent = message?.consent || {};
  if (consent.given !== true) return `messages[${index}].consent.given must be true (explicit WhatsApp opt-in)`;
  if (!['transactional', 'marketing'].includes(consent.purpose)) return `messages[${index}].consent.purpose must be transactional or marketing`;
  if (!/^[a-z0-9_-]{3,80}$/.test(String(consent.source || ''))) return `messages[${index}].consent.source must identify the recorded opt-in source`;
  const at = Date.parse(String(consent.recordedAt || ''));
  if (!Number.isFinite(at) || at > Date.now() || at < Date.UTC(2020, 0, 1)) return `messages[${index}].consent.recordedAt must be a valid historical ISO timestamp`;
  return null;
}

function allowedTemplates(env) {
  return new Set(String(env.WHATSAPP_ALLOWED_TEMPLATES || '')
    .split(',').map((s) => s.trim()).filter(Boolean));
}

function maskedRecipient(to) {
  const phone = normalizePhone(to);
  return phone ? '••••' + phone.slice(-4) : null;
}

function consentLedgerConfig(env) {
  return {
    url: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
  };
}

// A caller-supplied consent flag is not proof of opt-in. Check the locked-down
// server-only ledger before approving a message or making any outbound API call.
async function checkStoredConsent(env, message) {
  const { url, key } = consentLedgerConfig(env);
  if (!url || !key) throw new Error('WhatsApp consent ledger configuration is missing');
  const phone = '+' + normalizePhone(message.to);
  const purpose = message.consent.purpose;
  const filters = 'phone_e164=eq.' + encodeURIComponent(phone)
    + '&purpose=eq.' + encodeURIComponent(purpose)
    + '&select=status,source,consented_at,revoked_at&limit=1';
  const response = await fetch(url + '/rest/v1/whatsapp_contact_consents?' + filters, {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('WhatsApp consent ledger lookup failed');
  const rows = await response.json();
  const stored = Array.isArray(rows) ? rows[0] : null;
  if (!stored || stored.status !== 'opted_in' || stored.revoked_at) return false;
  if (stored.source !== message.consent.source) return false;
  // The caller must identify the same recorded consent event, not merely assert opt-in.
  const submitted = Date.parse(message.consent.recordedAt);
  const recorded = Date.parse(stored.consented_at);
  return Number.isFinite(submitted) && Number.isFinite(recorded)
    && Math.abs(submitted - recorded) < 1000;
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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const dryRun = body?.dryRun === true;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) return json({ error: 'messages must contain at least one template message' }, 400);
  if (messages.length > MAX_BATCH) return json({ error: `Maximum ${MAX_BATCH} messages per request` }, 400);

  for (let i = 0; i < messages.length; i += 1) {
    const error = validateMessage(messages[i], i);
    if (error) return json({ error }, 400);
  }

  const missing = requiredEnv(env);
  const idValid = validPhoneNumberId(env);
  const allowed = allowedTemplates(env);
  const preview = messages.map((message, index) => ({
    index,
    recipient: maskedRecipient(message.to),
    templateName: message.templateName,
    templateAllowlisted: allowed.has(message.templateName),
    consentValid: !consentError(message, index),
    consentIssue: consentError(message, index),
  }));

  const ledgerConfig = consentLedgerConfig(env);
  const ledgerConfigured = Boolean(ledgerConfig.url && ledgerConfig.key);
  let ledgerAvailable = ledgerConfigured;
  if (ledgerConfigured) {
    // The database is authoritative; a failed lookup fails closed.
    for (let i = 0; i < messages.length; i += 1) {
      if (!preview[i].consentValid) {
        preview[i].recordedOptIn = false;
        continue;
      }
      try {
        preview[i].recordedOptIn = await checkStoredConsent(env, messages[i]);
      } catch {
        ledgerAvailable = false;
        preview[i].recordedOptIn = false;
      }
    }
  } else {
    for (const item of preview) item.recordedOptIn = false;
  }

  // This protected preflight checks proposed messages without calling the Meta API.
  // It is the preferred first test for order updates and seller invitations.
  if (dryRun) {
    return json({
      dryRun: true,
      sent: 0,
      ready: !missing.length && idValid && Boolean(allowed.size) && ledgerAvailable && preview.every(x => x.templateAllowlisted && x.consentValid && x.recordedOptIn),
      missingConfiguration: [...missing, ...(!idValid ? ['WHATSAPP_PHONE_NUMBER_ID (numeric Meta ID required)'] : []), ...(!allowed.size ? ['WHATSAPP_ALLOWED_TEMPLATES'] : []), ...(!ledgerConfigured ? ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)'] : []), ...(!ledgerAvailable && ledgerConfigured ? ['WHATSAPP_CONSENT_LEDGER_UNAVAILABLE'] : [])],
      preview,
    });
  }

  if (missing.length) return json({ error: 'WhatsApp outreach is not configured', missing }, 503);
  if (!idValid) return json({ error: 'WHATSAPP_PHONE_NUMBER_ID must be the numeric Phone Number ID from Meta WhatsApp Manager, not a WhatsApp mobile number.' }, 503);
  if (!allowed.size) return json({ error: 'WHATSAPP_ALLOWED_TEMPLATES must list approved template names before business-initiated messages are sent.' }, 503);
  if (!ledgerAvailable) return json({ error: 'WhatsApp consent ledger is not available. Sending is disabled.' }, 503);

  for (let i = 0; i < messages.length; i += 1) {
    const issue = consentError(messages[i], i);
    if (issue) return json({ error: issue }, 400);
    if (!allowed.has(messages[i].templateName)) {
      return json({ error: `messages[${i}].templateName is not in WHATSAPP_ALLOWED_TEMPLATES` }, 400);
    }
    if (!preview[i].recordedOptIn) return json({ error: `messages[${i}] has no matching active recorded WhatsApp opt-in for the specified purpose` }, 403);
  }

  const results = [];
  for (const message of messages) {
    try {
      // Recheck immediately before each send in case the recipient opted out meanwhile.
      if (!(await checkStoredConsent(env, message))) {
        results.push({ to: maskedRecipient(message.to), ok: false, errorCode: 'CONSENT_REVOKED', errorMessage: 'No active recorded WhatsApp opt-in' });
        continue;
      }
      const result = await sendTemplate(env, message);
      results.push({ to: maskedRecipient(message.to), ...result });
    } catch (error) {
      console.error('WhatsApp outreach send failed', error?.message || String(error));
      results.push({ to: maskedRecipient(message.to), ok: false, httpStatus: null, messageId: null, errorCode: null, errorMessage: 'Network error' });
    }
  }

  const sent = results.filter((item) => item.ok).length;
  return json({ sent, failed: results.length - sent, results }, sent ? 200 : 502);
}

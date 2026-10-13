function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return safeEqual(`sha256=${toHex(digest)}`, signatureHeader);
}

function extractInboundMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      for (const message of value?.messages || []) {
        messages.push({
          id: message?.id || null,
          from: message?.from || null,
          type: message?.type || null,
          text: message?.text?.body || null,
          timestamp: message?.timestamp || null,
          phoneNumberId: metadata?.phone_number_id || null,
          businessPhone: metadata?.display_phone_number || null,
          raw: message || {},
        });
      }
    }
  }
  return messages;
}


const META_DELIVERY_STATUSES = new Set(['sent','delivered','read','failed']);

// WhatsApp Cloud API statuses arrive under value.statuses, not value.messages.
// Retain only message ID, status, timestamp and numeric Meta error code: no PII
// or raw webhook payload is copied into the delivery-history table.
function extractDeliveryStatuses(payload) {
  const receipts = [];
  for (const entry of (Array.isArray(payload?.entry) ? payload.entry : [])) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
      const statuses = change?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const item of statuses) {
        const providerMessageId = String(item?.id || '');
        const status = String(item?.status || '').toLowerCase();
        if (!/^wamid\.[a-zA-Z0-9._-]{1,249}$/.test(providerMessageId)
            || !META_DELIVERY_STATUSES.has(status)) continue;
        const seconds = Number(item?.timestamp);
        if (!Number.isSafeInteger(seconds) || seconds < 1577836800) continue;
        const eventAt = new Date(seconds * 1000);
        if (!Number.isFinite(eventAt.getTime()) || eventAt.getTime() > Date.now() + 300000) continue;
        const code = item?.errors?.[0]?.code;
        const errorCode = code == null ? null : String(code).slice(0,64);
        receipts.push({providerMessageId, status, eventAt: eventAt.toISOString(), errorCode});
      }
    }
  }
  return receipts;
}

async function ingestDeliveryStatus(env, receipt) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('WhatsApp delivery database configuration missing');
  const response = await fetch(base + '/rest/v1/rpc/record_whatsapp_delivery_status', {
    method: 'POST',
    headers: {apikey:key, Authorization:'Bearer ' + key, 'content-type':'application/json'},
    body: JSON.stringify({
      p_provider_message_id:receipt.providerMessageId,
      p_meta_status:receipt.status,
      p_event_at:receipt.eventAt,
      p_error_code:receipt.errorCode,
    }),
  });
  if (!response.ok) throw new Error('Could not record WhatsApp Meta delivery status');
  return response.json();
}

async function ingestMessage(env, message) {
  const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and a server-side Supabase key are required');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/ingest_whatsapp_inbound_event`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_external_message_id: message.id,
      p_sender_phone: message.from,
      p_message_type: message.type,
      p_message_text: message.text,
      p_phone_number_id: message.phoneNumberId,
      p_business_phone: message.businessPhone,
      p_meta_timestamp: message.timestamp
        ? new Date(Number(message.timestamp) * 1000).toISOString()
        : null,
      p_raw_message: message.raw,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ingest failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

// Explicit WhatsApp opt-in command is advertised on our seller opt-in page.
// Ordinary conversations and OTP replies must not be interpreted as marketing consent.
function consentCommand(message) {
  if (message.type !== 'text') return null;
  const command = String(message.text || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (command === 'JOIN FASHION SELLER') return 'opted_in';
  if (command === 'STOP' || command === 'STOP FASHION') return 'opted_out';
  return null;
}

async function storeConsentCommand(env, message) {
  // Only a Meta HMAC-signed webhook may change consent.
  if (!env.WHATSAPP_APP_SECRET) return;
  const status = consentCommand(message);
  if (!status) return;
  const digits = String(message.from || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits) || !message.id) throw new Error('Invalid WhatsApp consent command metadata');
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('WhatsApp consent database configuration missing');
  const eventAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : null;
  if (!eventAt || !Number.isFinite(eventAt.getTime())) throw new Error('Invalid Meta consent event timestamp');
  const response = await fetch(base + '/rest/v1/rpc/record_whatsapp_consent_command', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_phone_e164: '+' + digits,
      p_external_message_id: String(message.id),
      p_status: status,
      p_event_at: eventAt.toISOString(),
    }),
  });
  if (!response.ok) throw new Error('WhatsApp consent command could not be recorded');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (!env.WHATSAPP_VERIFY_TOKEN) {
    return new Response('Webhook verify token is not configured', { status: 500 });
  }

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();

  // Fail closed: never trust inbound content or delivery statuses if the
  // Meta app-secret is unset. Meta signs webhooks with X-Hub-Signature-256.
  if (!env.WHATSAPP_APP_SECRET) {
    return new Response('Webhook signature verification is not configured', { status: 503 });
  }
  const valid = await verifyMetaSignature(
    rawBody,
    request.headers.get('x-hub-signature-256'),
    env.WHATSAPP_APP_SECRET,
  );
  if (!valid) return new Response('Invalid signature', { status: 401 });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (payload?.object !== 'whatsapp_business_account') {
    return new Response('Ignored', { status: 200 });
  }

  const messages = extractInboundMessages(payload);
  const receipts = extractDeliveryStatuses(payload);
  if (!messages.length && !receipts.length) {
    return new Response('EVENT_RECEIVED', { status: 200 });
  }
  if (messages.length + receipts.length > 200) {
    return new Response('Too many WhatsApp events in a single webhook', { status: 413 });
  }

  try {
    const routed = [];
    for (const message of messages) {
      if (!message.id || !message.from) continue;
      routed.push(await ingestMessage(env, message));
      await storeConsentCommand(env, message);
    }
    let recorded = 0, duplicates = 0, matchedOrders = 0;
    for (const receipt of receipts) {
      const result = await ingestDeliveryStatus(env, receipt);
      if (result?.recorded === true) recorded += 1;
      if (result?.duplicate === true) duplicates += 1;
      if (result?.matched_order === true) matchedOrders += 1;
    }
    console.log('WhatsApp signed webhook processed', JSON.stringify({
      inboundCount: routed.length, deliveryReceipts: receipts.length,
      recorded, duplicates, matchedOrders,
    }));
    return new Response('EVENT_RECEIVED', { status: 200 });
  } catch (error) {
    console.error('WhatsApp webhook persistence failed', error?.message || String(error));
    return new Response('Routing failed', { status: 500 });
  }
}

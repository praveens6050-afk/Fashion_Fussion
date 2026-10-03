import { extractInboundWhatsAppMessages } from './whatsapp-types.js';

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
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

export async function routeInboundWhatsAppMessages(payload, env) {
  const messages = extractInboundWhatsAppMessages(payload);
  if (!messages.length) return [];

  const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for WhatsApp inbound routing');
  }

  const endpoint = `${supabaseUrl}/rest/v1/rpc/ingest_whatsapp_inbound_event`;
  const results = [];

  for (const message of messages) {
    const metaTimestamp = message.timestamp
      ? new Date(Number(message.timestamp) * 1000).toISOString()
      : null;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_external_message_id: message.id,
        p_sender_phone: message.from,
        p_message_type: message.type,
        p_message_text: message.text,
        p_phone_number_id: message.phoneNumberId,
        p_business_phone: message.displayPhoneNumber,
        p_meta_timestamp: metaTimestamp,
        p_raw_message: message.raw || {},
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase WhatsApp ingest failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const data = await response.json();
    results.push(Array.isArray(data) ? data[0] : data);
  }

  return results;
}

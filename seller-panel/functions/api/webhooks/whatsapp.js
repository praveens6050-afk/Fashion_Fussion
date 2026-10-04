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

  if (env.WHATSAPP_APP_SECRET) {
    const valid = await verifyMetaSignature(
      rawBody,
      request.headers.get('x-hub-signature-256'),
      env.WHATSAPP_APP_SECRET,
    );
    if (!valid) return new Response('Invalid signature', { status: 401 });
  }

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
  if (!messages.length) {
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  try {
    const routed = [];
    for (const message of messages) {
      if (!message.id || !message.from) continue;
      routed.push(await ingestMessage(env, message));
    }
    console.log('WhatsApp inbound persisted', JSON.stringify({
      count: routed.length,
      roles: routed.map(row => row?.sender_role || null),
    }));
    return new Response('EVENT_RECEIVED', { status: 200 });
  } catch (error) {
    console.error('WhatsApp inbound routing failed', error?.message || String(error));
    return new Response('Routing failed', { status: 500 });
  }
}

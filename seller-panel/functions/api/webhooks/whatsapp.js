function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function numberSet(value) {
  return new Set(String(value || '').split(',').map(digits).filter(Boolean));
}

function fallbackRole(env, phone) {
  const normalized = digits(phone);
  if (!normalized) return { role: 'unknown', userId: null, source: 'fallback' };
  if (numberSet(env.WHATSAPP_ADMIN_NUMBERS).has(normalized)) {
    return { role: 'admin', userId: null, source: 'fallback' };
  }
  if (numberSet(env.WHATSAPP_SELLER_NUMBERS).has(normalized)) {
    return { role: 'seller', userId: null, source: 'fallback' };
  }
  return { role: 'customer', userId: null, source: 'fallback' };
}

async function resolveRoleFromSupabase(env, phone) {
  const normalized = digits(phone);
  if (!normalized) return { role: 'unknown', userId: null, source: 'invalid' };

  if (!env.SUPABASE_SERVER_KEY) return fallbackRole(env, normalized);

  const url = 'https://gmdevprqtvoshbbytsxf.supabase.co/rest/v1/rpc/resolve_whatsapp_role';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVER_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVER_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ input_phone: normalized }),
    });

    if (!response.ok) {
      console.error('WhatsApp role lookup failed', response.status, await response.text());
      return fallbackRole(env, normalized);
    }

    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    const role = ['admin', 'seller', 'customer', 'unknown'].includes(row?.role) ? row.role : 'customer';
    return {
      role,
      userId: row?.user_id || null,
      source: 'supabase',
    };
  } catch (error) {
    console.error('WhatsApp role lookup exception', error?.message || String(error));
    return fallbackRole(env, normalized);
  }
}

function extractEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const message of value.messages || []) {
        events.push({
          type: 'message',
          phone: digits(message.from),
          messageId: message.id || null,
          payload: message,
        });
      }
      for (const status of value.statuses || []) {
        events.push({
          type: 'status',
          phone: digits(status.recipient_id),
          messageId: status.id || null,
          payload: status,
        });
      }
    }
  }
  return events;
}

async function routeEvent(env, event) {
  const resolved = await resolveRoleFromSupabase(env, event.phone);
  console.log('WhatsApp routed event', JSON.stringify({
    role: resolved.role,
    userId: resolved.userId,
    source: resolved.source,
    type: event.type,
    phone: event.phone,
    messageId: event.messageId,
  }));

  console.log(`WhatsApp route target: ${resolved.role}`);
  return resolved;
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

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const events = extractEvents(payload);
  const routed = await Promise.all(events.map(async event => {
    const resolved = await routeEvent(env, event);
    return {
      role: resolved.role,
      userId: resolved.userId,
      source: resolved.source,
      type: event.type,
      phone: event.phone,
      messageId: event.messageId,
    };
  }));

  console.log('WhatsApp webhook event', JSON.stringify({ eventCount: events.length, routed }));
  return new Response('EVENT_RECEIVED', { status: 200 });
}

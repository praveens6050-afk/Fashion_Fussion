function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function numberSet(value) {
  return new Set(String(value || '').split(',').map(digits).filter(Boolean));
}

function classifyRole(env, phone) {
  const normalized = digits(phone);
  if (!normalized) return 'unknown';
  if (numberSet(env.WHATSAPP_ADMIN_NUMBERS).has(normalized)) return 'admin';
  if (numberSet(env.WHATSAPP_SELLER_NUMBERS).has(normalized)) return 'seller';
  return 'customer';
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

function routeEvent(env, event) {
  const role = classifyRole(env, event.phone);
  console.log('WhatsApp routed event', JSON.stringify({
    role,
    type: event.type,
    phone: event.phone,
    messageId: event.messageId,
  }));

  if (role === 'admin') {
    console.log('WhatsApp route target: admin');
  } else if (role === 'seller') {
    console.log('WhatsApp route target: seller');
  } else {
    console.log('WhatsApp route target: customer');
  }

  return role;
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
  const routed = events.map(event => ({
    role: routeEvent(env, event),
    type: event.type,
    phone: event.phone,
    messageId: event.messageId,
  }));

  console.log('WhatsApp webhook event', JSON.stringify({ eventCount: events.length, routed }));
  return new Response('EVENT_RECEIVED', { status: 200 });
}

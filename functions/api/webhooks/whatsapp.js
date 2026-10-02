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
  const { request } = context;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Meta expects a fast 200 response for webhook deliveries.
  // Message/status processing can be added here or delegated to a queue later.
  console.log('WhatsApp webhook event', JSON.stringify(payload));

  return new Response('EVENT_RECEIVED', { status: 200 });
}

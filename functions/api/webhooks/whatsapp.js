import { routeInboundWhatsAppMessages, verifyMetaWebhookSignature } from './whatsapp-router.js';

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
    const valid = await verifyMetaWebhookSignature(
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

  try {
    const routed = await routeInboundWhatsAppMessages(payload, env);
    console.log('WhatsApp webhook processed', JSON.stringify({ count: routed.length }));
    return new Response('EVENT_RECEIVED', { status: 200 });
  } catch (error) {
    console.error('WhatsApp webhook routing failed', error?.message || String(error));
    return new Response('Routing failed', { status: 500 });
  }
}

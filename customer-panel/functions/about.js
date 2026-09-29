export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const url = new URL(context.request.url);
  url.pathname = '/about';
  const assetResponse = await context.env.ASSETS.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: context.request.headers
  }));

  const headers = new Headers(assetResponse.headers);
  headers.set('Link', '<https://www.fashionfussion.in/about>; rel="canonical"');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');

  return new Response(method === 'HEAD' ? null : assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}

const SOURCES = {
  '34': 'https://deodap.in/products/outdoor-sport-water-bottle-400ml-leak-proof-bpa-free-for-travel-cold-and-hot-water-glass-water-bottle-with-daily-water-intake-for-gym-and-children-nice-bottle-1-pc?variant=52365871022390',
  '35': 'https://deodap.in/products/airtight-lunch-box-2-compartment-leak-proof-lunchie?variant=45511715455286',
  '36': 'https://deodap.in/products/motivational-plastic-water-bottle?variant=48944289579318'
};

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function findOgImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const id = String(context.params?.id || '');
  const sourceUrl = SOURCES[id];
  if (!sourceUrl) return new Response('Product image not found', { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(context.request.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    if (method === 'HEAD') return new Response(null, { status: cached.status, headers: cached.headers });
    return cached;
  }

  const pageResponse = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'FashionFussion-ProductImage/1.0',
      'Accept': 'text/html,application/xhtml+xml'
    },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!pageResponse.ok) return new Response('Source image unavailable', { status: 502 });

  const html = await pageResponse.text();
  const imageUrl = findOgImage(html);
  if (!imageUrl) return new Response('Source image metadata unavailable', { status: 502 });

  const imageResponse = await fetch(imageUrl, {
    headers: { 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' },
    cf: { cacheTtl: 604800, cacheEverything: true }
  });
  if (!imageResponse.ok) return new Response('Source image fetch failed', { status: 502 });

  const contentType = imageResponse.headers.get('Content-Type') || 'image/jpeg';
  if (!contentType.toLowerCase().startsWith('image/')) {
    return new Response('Invalid image response', { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  headers.set('X-Content-Type-Options', 'nosniff');

  const response = new Response(method === 'HEAD' ? null : imageResponse.body, {
    status: 200,
    headers
  });

  if (method === 'GET') context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

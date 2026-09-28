const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, serverHeaders } = require('../lib');

const SITE_ORIGIN = 'https://fashionfussion.in';

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, char => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;'
  })[char]);
}

function writeError(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(message);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return writeError(res, 405, 'Method not allowed');
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return writeError(res, 503, 'Sitemap is temporarily unavailable');
  }

  try {
    const base = String(SUPABASE_URL).replace(/\/+$/, '');
    const url = new URL(base + '/rest/v1/products');
    url.searchParams.set('is_active', 'eq.true');
    url.searchParams.set('select', 'id,updated_at');
    url.searchParams.set('order', 'id.asc');

    const response = await fetch(url.toString(), {
      headers: { ...serverHeaders, Accept: 'application/json' }
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(rows)) {
      return writeError(res, 502, 'Sitemap is temporarily unavailable');
    }

    const urls = rows
      .filter(row => /^\d+$/.test(String(row?.id ?? '')))
      .map(row => {
        const loc = `${SITE_ORIGIN}/product?id=${encodeURIComponent(String(row.id))}`;
        const updated = row.updated_at ? new Date(row.updated_at) : null;
        const lastmod = updated && !Number.isNaN(updated.getTime()) ? updated.toISOString() : '';
        return [
          '  <url>',
          `    <loc>${escapeXml(loc)}</loc>`,
          lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
          '    <changefreq>daily</changefreq>',
          '    <priority>0.8</priority>',
          '  </url>'
        ].filter(Boolean).join('\n');
      });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      '</urlset>',
      ''
    ].join('\n');

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    if (req.method === 'HEAD') return res.end();
    return res.end(xml);
  } catch (error) {
    console.error('Product sitemap generation failed', error?.message || error);
    return writeError(res, 502, 'Sitemap is temporarily unavailable');
  }
};

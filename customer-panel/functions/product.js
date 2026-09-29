const SITE_ORIGIN = 'https://www.fashionfussion.in';
const SITE_NAME = 'Fashion Fussion';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength) {
  const text = clean(value);
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, Math.max(1, maxLength - 1));
  const wordSafe = clipped.replace(/\s+\S*$/, '').trim();
  return (wordSafe || clipped.trim()) + '…';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function safeImageUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function priceText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(number);
}

async function loadProduct(env, id) {
  const base = clean(env.SUPABASE_URL).replace(/\/+$/, '');
  const serviceKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!base || !serviceKey) throw new Error('Supabase server configuration is missing');

  const url = new URL(base + '/rest/v1/products');
  url.searchParams.set('id', 'eq.' + id);
  url.searchParams.set('is_active', 'eq.true');
  url.searchParams.set(
    'select',
    'id,name,description,category,price,image_url,gst_rate,is_active,updated_at,bulk_enabled,bulk_min_qty,has_variants'
  );
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Accept: 'application/json'
    }
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error('Product lookup failed');
  return Array.isArray(rows) ? rows[0] || null : null;
}

function schemaFor(product, canonical, image) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: clean(product.name),
    url: canonical
  };
  const description = clean(product.description);
  const category = clean(product.category);
  if (description) schema.description = description;
  if (category) schema.category = category;
  if (image) schema.image = [image];
  return schema;
}

function addNonceToCsp(value, nonce) {
  const csp = String(value || '');
  if (!csp) return csp;
  const source = `'nonce-${nonce}'`;
  if (/((?:^|;)\s*script-src\s+)/i.test(csp)) {
    return csp.replace(/((?:^|;)\s*script-src\s+)/i, `$1${source} `);
  }
  return csp;
}

function headMarkup({ title, description, canonical, image, nonce, schema }) {
  const tags = [
    `<link rel="canonical" href="${escapeHtml(canonical)}" data-product-seo="canonical">`,
    '<meta property="og:type" content="product" data-product-seo="og-type">',
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" data-product-seo="og-site">`,
    `<meta property="og:title" content="${escapeHtml(title)}" data-product-seo="og-title">`,
    `<meta property="og:description" content="${escapeHtml(description)}" data-product-seo="og-description">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" data-product-seo="og-url">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" data-product-seo="twitter-card">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" data-product-seo="twitter-title">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" data-product-seo="twitter-description">`
  ];
  if (image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(image)}" data-product-seo="og-image">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}" data-product-seo="twitter-image">`);
  }
  const json = JSON.stringify(schema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  tags.push(`<script type="application/ld+json" nonce="${nonce}" data-product-schema>${json}</script>`);
  return '\n' + tags.join('\n') + '\n';
}

function rewriteProductPage(asset, product, id) {
  const canonical = `${SITE_ORIGIN}/product?id=${encodeURIComponent(id)}`;
  const image = safeImageUrl(product.image_url);
  const title = `${truncate(product.name, 52)} | ${SITE_NAME}`;
  const description = truncate(
    product.description || `${product.name} from ${SITE_NAME}. View product details and purchase options.`,
    158
  );
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const schema = schemaFor(product, canonical, image);
  const displayPrice = priceText(product.price);
  const category = clean(product.category) || 'General';
  const gst = Number(product.gst_rate);

  const response = new Response(asset.body, asset);
  response.headers.delete('content-length');
  response.headers.delete('etag');
  response.headers.set('X-Robots-Tag', 'index, follow, max-image-preview:large');
  response.headers.set('Link', `<${canonical}>; rel="canonical"`);
  response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
  const csp = response.headers.get('content-security-policy');
  if (csp) response.headers.set('Content-Security-Policy', addNonceToCsp(csp, nonce));

  let rewriter = new HTMLRewriter()
    .on('title', { element(element) { element.setInnerContent(title); } })
    .on('meta[name="description"]', { element(element) { element.setAttribute('content', description); } })
    .on('meta[name="robots"]', { element(element) { element.setAttribute('content', 'index,follow,max-image-preview:large'); } })
    .on('head', { element(element) { element.append(headMarkup({ title, description, canonical, image, nonce, schema }), { html: true }); } })
    .on('#loading', { element(element) { element.setAttribute('hidden', ''); } })
    .on('#product', {
      element(element) {
        element.removeAttribute('hidden');
        element.setAttribute('data-seo-rendered', 'true');
        element.setAttribute('data-seo-product-id', String(id));
      }
    })
    .on('#name', { element(element) { element.setInnerContent(clean(product.name)); } })
    .on('#crumbName', { element(element) { element.setInnerContent(clean(product.name)); } })
    .on('#category', { element(element) { element.setInnerContent(category); } })
    .on('#crumbCat', { element(element) { element.setInnerContent(category); } })
    .on('#description', { element(element) { element.setInnerContent(clean(product.description) || `Product from ${SITE_NAME}.`); } })
    .on('#unitNote', { element(element) { element.setInnerContent('Per piece'); } });

  if (displayPrice) {
    rewriter = rewriter
      .on('#price', { element(element) { element.setInnerContent(displayPrice); } })
      .on('#buyPrice', { element(element) { element.setInnerContent(displayPrice); } });
  }
  if (Number.isFinite(gst) && gst >= 0) {
    rewriter = rewriter.on('#gst', { element(element) { element.setInnerContent(String(gst)); } });
  }
  if (image) {
    rewriter = rewriter.on('#gallery', {
      element(element) {
        element.setInnerContent(
          `<img src="${escapeHtml(image)}" alt="${escapeHtml(clean(product.name) || 'Product')}" data-seo-product-image>`,
          { html: true }
        );
      }
    });
  }
  if (product.has_variants === true) {
    const disableUntilVariantLoads = {
      element(element) {
        element.setAttribute('disabled', '');
        element.setAttribute('title', 'Select an available product option first');
      }
    };
    rewriter = rewriter
      .on('#add', disableUntilVariantLoads)
      .on('#buy', disableUntilVariantLoads);
  }

  return rewriter.transform(response);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return context.next();

  const url = new URL(context.request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!/^\d+$/.test(id) || id === '0') return context.next();

  let product;
  try {
    product = await loadProduct(context.env, id);
  } catch (error) {
    console.error('Product SEO lookup failed', error?.message || error);
    return context.next();
  }

  if (!product) {
    const asset = await context.next();
    const headers = new Headers(asset.headers);
    headers.set('X-Robots-Tag', 'noindex, follow');
    headers.delete('content-length');
    return new Response(asset.body, { status: 404, headers });
  }

  const asset = await context.next();
  if (!asset.ok) return asset;
  return rewriteProductPage(asset, product, id);
}

const required = ['CUSTOMER_URL','ADMIN_URL','SELLER_URL'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const bases = {
  customer: process.env.CUSTOMER_URL.replace(/\/$/, ''),
  admin: process.env.ADMIN_URL.replace(/\/$/, ''),
  seller: process.env.SELLER_URL.replace(/\/$/, '')
};

async function checkPage(label, url, expectedText) {
  const response = await fetch(url, { redirect: 'follow' });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  if (expectedText && !text.includes(expectedText)) throw new Error(`${label} missing expected content: ${expectedText}`);
  const nosniff = response.headers.get('x-content-type-options');
  const frame = response.headers.get('x-frame-options');
  const csp = response.headers.get('content-security-policy');
  if (nosniff !== 'nosniff') throw new Error(`${label} missing nosniff header`);
  if (frame !== 'DENY') throw new Error(`${label} missing DENY frame protection`);
  if (!csp) throw new Error(`${label} missing Content-Security-Policy`);
  console.log(`PASS ${label}: ${response.status}`);
}

async function checkCrawlerRoute(label, url) {
  const userAgent = 'Mozilla/5.0 (compatible; CashfreeLinkChecker/1.0; +https://www.cashfree.com/)';
  const getResponse = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' }
  });
  const text = await getResponse.text();
  if (getResponse.status !== 200) throw new Error(`${label} crawler GET returned ${getResponse.status}; location=${getResponse.headers.get('location') || ''}`);
  if (!text.includes('About Fashion_Fussion')) throw new Error(`${label} crawler GET missing About marker`);
  const canonical = String(getResponse.headers.get('link') || '');
  if (!canonical.includes('<https://fashionfussion.in/about>') || !/rel="?canonical"?/i.test(canonical)) {
    throw new Error(`${label} crawler GET canonical header is ${canonical}`);
  }

  const headResponse = await fetch(url, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' }
  });
  if (headResponse.status !== 200) throw new Error(`${label} crawler HEAD returned ${headResponse.status}; location=${headResponse.headers.get('location') || ''}`);
  if (headResponse.headers.get('location')) throw new Error(`${label} crawler HEAD unexpectedly redirects to ${headResponse.headers.get('location')}`);
  console.log(`PASS ${label}: crawler GET 200, HEAD 200, no redirect, canonical /about`);
}

async function checkApi(label, url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer invalid-preview-smoke-token' },
    body: JSON.stringify({})
  });
  const text = await response.text();
  if (response.status >= 500) throw new Error(`${label} server error ${response.status}: ${text}`);
  if (/configuration is missing/i.test(text)) throw new Error(`${label} runtime secrets/configuration missing: ${text}`);
  console.log(`PASS ${label}: expected auth/config response ${response.status}`);
}

await checkPage('Customer homepage', `${bases.customer}/`, 'Fashion Fussion');
await checkPage('Customer About clean route', `${bases.customer}/about`, 'About Fashion_Fussion');
await checkPage('Customer About HTML route', `${bases.customer}/about.html`, 'About Fashion_Fussion');
await checkCrawlerRoute('Customer About clean crawler route', `${bases.customer}/about`);
await checkCrawlerRoute('Customer About HTML crawler route', `${bases.customer}/about.html`);
await checkPage('Admin login', `${bases.admin}/login.html`, 'Admin');
await checkPage('Seller login', `${bases.seller}/login.html`, 'Seller');
await checkApi('Customer API', `${bases.customer}/api/shipping-status`);
await checkApi('Admin API', `${bases.admin}/api/admin-order-action`);

const unknown = await fetch(`${bases.customer}/api/cloudflare-smoke-not-found`, { method: 'POST' });
if (unknown.status !== 404) throw new Error(`Unknown Customer API should return 404, got ${unknown.status}`);
console.log('PASS unknown Customer API: 404');
console.log('Cloudflare public smoke checks passed.');

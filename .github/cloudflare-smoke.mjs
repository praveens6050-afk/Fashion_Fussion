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
await checkPage('Admin login', `${bases.admin}/login.html`, 'Admin');
await checkPage('Seller login', `${bases.seller}/login.html`, 'Seller');
await checkApi('Customer API', `${bases.customer}/api/shipping-status`);
await checkApi('Admin API', `${bases.admin}/api/admin-order-action`);

const unknown = await fetch(`${bases.customer}/api/cloudflare-smoke-not-found`, { method: 'POST' });
if (unknown.status !== 404) throw new Error(`Unknown Customer API should return 404, got ${unknown.status}`);
console.log('PASS unknown Customer API: 404');
console.log('Cloudflare public smoke checks passed.');

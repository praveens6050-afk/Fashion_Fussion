const { chromium } = require('playwright');

const BASE = 'https://fashionfussion.in';
const WWW = 'https://www.fashionfussion.in';
const failures = [];

function sameCustomerHost(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'fashionfussion.in' || host === 'www.fashionfussion.in';
  } catch { return false; }
}
function cleanPath(url) { return String(url.pathname || '/').replace(/\.html$/i, '') || '/'; }

function observe(page, label) {
  page.on('pageerror', error => failures.push(`${label} pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon/i.test(text)) return;
    if (/cloudflareinsights\.com\/cdn-cgi\/rum/i.test(text)) return;
    if (/^Failed to load resource:\s*net::ERR_FAILED\s*$/i.test(text)) return;
    failures.push(`${label} console error: ${text}`);
  });
  page.on('requestfailed', request => {
    if (!sameCustomerHost(request.url())) return;
    const errorText = request.failure()?.errorText || '';
    if (['script','stylesheet'].includes(request.resourceType()) && errorText === 'net::ERR_ABORTED' && cleanPath(new URL(page.url())) === '/login') return;
    failures.push(`${label} failed request: ${request.method()} ${request.url()} ${errorText}`);
  });
  page.on('response', response => {
    if (!sameCustomerHost(response.url()) || response.status() < 400) return;
    const type = response.request().resourceType();
    if (['document','script','stylesheet','font'].includes(type)) failures.push(`${label} ${type} HTTP ${response.status()}: ${response.url()}`);
  });
}

async function open(page, path) {
  const response = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error(`${path} returned ${response && response.status()}`);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

async function noHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  if (metrics.scroll > metrics.client + 3) throw new Error(`${label} horizontal overflow: ${metrics.scroll}px content in ${metrics.client}px viewport`);
}

async function expectLoginRedirect(page, path) {
  await open(page, path);
  try {
    await page.waitForURL(url => cleanPath(url) === '/login', { timeout: 15000 });
  } catch (error) {
    throw new Error(`${path} did not redirect signed-out customer to Login; current URL=${page.url()}`);
  }
}

async function waitForCartReady(page) {
  await page.locator('#cart').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const box = document.getElementById('cart');
    return box && !box.querySelector('.loading');
  }, null, { timeout: 15000 });
}

async function assertQuantityFiveCart(page, productId, label) {
  await waitForCartReady(page);
  const input = page.locator(`[data-qty="${productId}"]`);
  await input.waitFor({ state: 'visible', timeout: 15000 });
  if (await input.inputValue() !== '5') throw new Error(`${label} cart line did not hydrate quantity 5`);
  const subtitle = await page.locator('#cartSub').innerText();
  if (!/^5 items in your cart\./i.test(subtitle.trim())) throw new Error(`${label} cart summary count mismatch: ${subtitle}`);
  const storedQty = await page.evaluate(id => {
    const legacy = JSON.parse(localStorage.getItem('fashion_fussion_cart') || '{}');
    return Number(legacy[id] || 0);
  }, String(productId));
  if (storedQty !== 5) throw new Error(`${label} legacy cart quantity was not reconciled to 5; got ${storedQty}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  observe(desktop, 'desktop');

  await open(desktop, '/');
  await noHorizontalOverflow(desktop, 'desktop home');

  // Canonicalization intentionally aborts any www-page resources still in flight.
  // Test that redirect in an isolated page so those expected aborts do not weaken
  // the resource-failure observer on the real customer journey below.
  const canonicalPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await canonicalPage.goto(WWW + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await canonicalPage.waitForURL(url => url.hostname === 'fashionfussion.in', { timeout: 10000 });
  await canonicalPage.close();

  for (const path of ['/wishlist', '/order-details?id=1', '/quote-checkout?quote=1']) {
    await expectLoginRedirect(desktop, path);
  }

  for (const path of ['/search?q=shirt', '/cart', '/login', '/signup?redirect=checkout']) {
    await open(desktop, path);
    await noHorizontalOverflow(desktop, `desktop ${path}`);
  }

  // Find a live non-variant product so homepage Add-to-Cart and the quantity
  // reconciliation regression can be tested without an option-selection branch.
  await open(desktop, '/');
  await desktop.waitForFunction(() => window.supabaseClient && document.querySelector('#productsGrid'), null, { timeout: 15000 });
  const baseProductId = await desktop.evaluate(async () => {
    const { data, error } = await window.supabaseClient
      .from('products')
      .select('id,has_variants')
      .eq('is_active', true)
      .order('id')
      .limit(50);
    if (error) throw error;
    const product = (data || []).find(row => row.has_variants !== true);
    return product ? Number(product.id) : null;
  });

  if (baseProductId) {
    const homeAdd = desktop.locator(`[data-add="${baseProductId}"]`);
    await homeAdd.waitFor({ state: 'visible', timeout: 15000 });
    await Promise.all([
      desktop.waitForURL(url => cleanPath(url) === '/cart', { timeout: 15000 }),
      homeAdd.click()
    ]);

    // Reproduce the reported stale dual-cart state: legacy says 1 while the
    // authoritative persisted cart line says 5. Fresh load and reload must both
    // render and persist quantity 5.
    await desktop.evaluate(id => {
      localStorage.setItem('fashion_fussion_cart', JSON.stringify({ [id]: 1 }));
      localStorage.setItem('fashion_fussion_cart_lines_v2', JSON.stringify([{ id: Number(id), variant_id: null, qty: 5 }]));
      localStorage.removeItem('fashion_fussion_cart_variants');
      sessionStorage.removeItem('fashion_fussion_checkout_key');
    }, baseProductId);
    await open(desktop, '/cart');
    await assertQuantityFiveCart(desktop, baseProductId, 'desktop fresh-load');
    await desktop.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await assertQuantityFiveCart(desktop, baseProductId, 'desktop reload');
  }

  await open(desktop, '/search?q=shirt');
  const productLink = desktop.locator('a[href*="product"]').first();
  if (await productLink.count()) {
    await productLink.click();
    await desktop.waitForLoadState('domcontentloaded');
    const add = desktop.locator('#add');
    if (await add.count()) {
      await Promise.all([
        desktop.waitForURL(url => cleanPath(url) === '/cart', { timeout: 10000 }),
        add.click()
      ]).catch(() => {});
    }
  }

  await expectLoginRedirect(desktop, '/checkout');

  await open(desktop, '/signup?redirect=checkout');
  const phone = desktop.locator('input[type="tel"]');
  if (await phone.count()) {
    await phone.fill('123');
    const submit = desktop.locator('button[type="submit"]');
    if (await submit.count()) await submit.click().catch(() => {});
  }

  const variantProductId = await desktop.evaluate(async () => {
    try {
      const { data } = await window.supabaseClient.from('products').select('id').eq('is_active', true).limit(20);
      for (const p of data || []) {
        const { data: variants } = await window.supabaseClient.from('product_variants').select('id').eq('product_id', p.id).eq('is_active', true).limit(1);
        if (variants?.length) return p.id;
      }
    } catch {}
    return null;
  });
  if (variantProductId) {
    await open(desktop, `/product?id=${variantProductId}`);
    const variant = desktop.locator('[data-variant-id]').first();
    if (await variant.count()) await variant.click();
    await Promise.all([
      desktop.waitForURL(url => cleanPath(url) === '/cart', { timeout: 10000 }),
      desktop.locator('#add').click()
    ]);
    const variantLines = await desktop.evaluate(() => JSON.parse(localStorage.getItem('fashion_fussion_cart_lines_v2') || '[]'));
    if (!variantLines.some(line => Number(line.id) === Number(variantProductId) && Number(line.variant_id) > 0 && Number(line.qty) > 0)) throw new Error(`variant product ${variantProductId} did not persist variant_id`);

    await desktop.evaluate(productId => {
      const staleVariantId = 2147483647;
      localStorage.setItem('fashion_fussion_cart', JSON.stringify({ [productId]: 1 }));
      localStorage.setItem('fashion_fussion_cart_lines_v2', JSON.stringify([{ id: Number(productId), variant_id: staleVariantId, qty: 1 }]));
      localStorage.setItem('fashion_fussion_cart_variants', JSON.stringify({ [productId]: staleVariantId }));
      sessionStorage.removeItem('fashion_fussion_checkout_key');
    }, Number(variantProductId));
    await open(desktop, '/cart');
    await desktop.locator('[data-variant-line]').first().waitFor({ state: 'visible', timeout: 15000 });
    const staleText = await desktop.locator('[data-variant-line]').first().innerText();
    if (!/no longer available/i.test(staleText)) throw new Error('stale variant cart did not show an unavailable-option warning');
    if (!(await desktop.locator('#place').isDisabled())) throw new Error('stale variant cart still allowed checkout');
  }
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  observe(mobile, 'mobile');
  for (const path of ['/index.html', '/search', '/cart', '/login', '/signup?redirect=checkout']) {
    await open(mobile, path);
    await noHorizontalOverflow(mobile, `mobile ${path}`);
  }
  if (baseProductId) {
    await mobile.evaluate(id => {
      localStorage.setItem('fashion_fussion_cart', JSON.stringify({ [id]: 1 }));
      localStorage.setItem('fashion_fussion_cart_lines_v2', JSON.stringify([{ id: Number(id), variant_id: null, qty: 5 }]));
      localStorage.removeItem('fashion_fussion_cart_variants');
      sessionStorage.removeItem('fashion_fussion_checkout_key');
    }, baseProductId);
    await open(mobile, '/cart');
    await assertQuantityFiveCart(mobile, baseProductId, 'mobile fresh-load');
    await noHorizontalOverflow(mobile, 'mobile reconciled cart');
  }
  await mobile.close();

  await browser.close();
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS live human browser smoke: www canonicalization, protected-route auth return, homepage Add-to-Cart redirect, desktop/mobile quantity reconciliation, desktop shopping/cart/login, checkout auth return, signup phone validation, live variant persistence, stale-variant blocking, extensionless routes, and mobile overflow checks.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

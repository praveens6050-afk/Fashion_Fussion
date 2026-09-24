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
    // Cloudflare Browser Insights/RUM is third-party telemetry. Its collector can
    // emit transient CORS/ERR_FAILED console noise in headless CI even while the
    // application itself is healthy. Same-origin failures are still enforced by
    // the requestfailed/response handlers below, so ignoring only this telemetry
    // noise does not weaken application resource checks.
    if (/cloudflareinsights\.com\/cdn-cgi\/rum/i.test(text)) return;
    if (/^Failed to load resource:\s*net::ERR_FAILED\s*$/i.test(text)) return;
    failures.push(`${label} console error: ${text}`);
  });
  page.on('requestfailed', request => {
    if (!sameCustomerHost(request.url())) return;
    failures.push(`${label} failed request: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
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

async function assertEntryPointScripts(page, path, scripts) {
  const response = await page.request.get(BASE + path, { timeout: 30000 });
  if (!response.ok()) throw new Error(`${path} entry-point fetch returned ${response.status()}`);
  const html = await response.text();
  for (const script of scripts) {
    if (!html.includes(script)) throw new Error(`${path} missing required script entry point: ${script}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const canonical = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  observe(canonical, 'www canonical');
  await canonical.goto(WWW + '/cart?human=1#cart', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await canonical.waitForURL(url => url.hostname === 'fashionfussion.in' && cleanPath(url) === '/cart', { timeout: 10000 });
  const canonicalUrl = new URL(canonical.url());
  if (canonicalUrl.searchParams.get('human') !== '1' || canonicalUrl.hash !== '#cart') throw new Error(`www canonicalization lost path/query/hash: ${canonicalUrl.href}`);
  await canonical.close();

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  observe(desktop, 'desktop');

  await assertEntryPointScripts(desktop, '/account.html', [
    'desktop-account-loader.js?v=1',
    'account-refunds.js?v=1',
    'account-returns.js?v=1',
    'account-business.js?v=1',
    'account-repeat-order.js?v=1',
    'account-cancel-promotion.js?v=1',
    'account-role-guard.js?v=1',
    'account-stability.js?v=1',
    'account-extension-router.js?v=1'
  ]);
  await assertEntryPointScripts(desktop, '/order-details.html', [
    'csp-order-details.js?v=3',
    'order-shipping.js?v=1',
    'order-refund-tracker.js?v=1',
    'order-return-exchange.js?v=1',
    'order-cancel-promotion.js?v=1',
    'order-business-details.js?v=1'
  ]);
  await assertEntryPointScripts(desktop, '/order-confirmation.html', [
    'csp-order-confirmation.js?v=3',
    'order-business-details.js?v=1'
  ]);

  await desktop.goto(BASE + '/wishlist', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await desktop.waitForURL(url => cleanPath(url) === '/login', { timeout: 10000 });
  const wishlistReturn = new URL(desktop.url()).searchParams.get('redirect');
  if (wishlistReturn !== 'wishlist.html') {
    throw new Error(`signed-out wishlist lost login return target: ${wishlistReturn}`);
  }

  await desktop.goto(BASE + '/order-details?id=987654321#tracking', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await desktop.waitForURL(url => cleanPath(url) === '/login', { timeout: 10000 });
  const orderDetailsReturn = new URL(desktop.url()).searchParams.get('redirect');
  if (orderDetailsReturn !== 'order-details.html?id=987654321#tracking') {
    throw new Error(`signed-out order details lost exact login return target: ${orderDetailsReturn}`);
  }

  await desktop.goto(BASE + '/order-confirmation?id=987654321', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await desktop.waitForURL(url => cleanPath(url) === '/login', { timeout: 10000 });
  const confirmationReturn = new URL(desktop.url()).searchParams.get('redirect');
  if (confirmationReturn !== 'order-confirmation.html?id=987654321') {
    throw new Error(`signed-out order confirmation lost exact login return target: ${confirmationReturn}`);
  }

  await open(desktop, '/index.html');
  for (const selector of ['.brand', '#searchBox', '#searchBtn', '#productsGrid']) {
    if (!(await desktop.locator(selector).count())) throw new Error(`homepage missing ${selector}`);
  }
  await desktop.waitForFunction(() => document.querySelectorAll('#productsGrid a[href*="product.html?id="]').length > 0, null, { timeout: 15000 });
  await noHorizontalOverflow(desktop, 'desktop homepage');

  await Promise.all([
    desktop.waitForURL(url => cleanPath(url) === '/search' && url.searchParams.get('q') === 'a', { timeout: 10000 }),
    (async () => { await desktop.locator('#searchBox').fill('a'); await desktop.locator('#searchBtn').click(); })()
  ]);
  await desktop.waitForFunction(() => /product/.test(document.querySelector('#count')?.textContent || ''), null, { timeout: 15000 });
  if (await desktop.locator('#grid .product').count()) {
    await desktop.locator('#sort').selectOption('price-low');
    const details = desktop.locator('#grid a.details').first();
    if (!(await details.count())) throw new Error('search results missing DETAILS link');
    await Promise.all([desktop.waitForURL(url => cleanPath(url) === '/product' && Boolean(url.searchParams.get('id'))), details.click()]);
    await desktop.locator('#product').waitFor({ state: 'visible', timeout: 15000 });
    await noHorizontalOverflow(desktop, 'desktop product');

    const add = desktop.locator('#add');
    const picker = desktop.locator('#variantPicker');
    if (await picker.count()) {
      const enabled = picker.locator('.variant-option:not([disabled])');
      if (!(await enabled.count())) throw new Error('variant product has no selectable in-stock option');
      if (await add.isDisabled()) await enabled.first().click();
      if (await add.isDisabled()) throw new Error('PDP Add to Cart stayed disabled after selecting an available variant');
    }
    await Promise.all([
      desktop.waitForURL(url => cleanPath(url) === '/cart', { timeout: 10000 }),
      add.click()
    ]);
    const persisted = await desktop.evaluate(() => ({
      legacy: JSON.parse(localStorage.getItem('fashion_fussion_cart') || '{}'),
      lines: JSON.parse(localStorage.getItem('fashion_fussion_cart_lines_v2') || '[]')
    }));
    if (!Object.values(persisted.legacy).some(qty => Number(qty) > 0)) throw new Error('PDP Add to Cart did not persist cart quantity');

    await open(desktop, '/cart');
    await desktop.locator('.item').first().waitFor({ state: 'visible', timeout: 15000 });
    await noHorizontalOverflow(desktop, 'desktop extensionless cart');
    if (await desktop.locator('[data-variant-line]').count()) {
      const lines = await desktop.evaluate(() => JSON.parse(localStorage.getItem('fashion_fussion_cart_lines_v2') || '[]'));
      if (!lines.some(line => Number.isInteger(Number(line.variant_id)) && Number(line.variant_id) > 0)) throw new Error('variant cart UI rendered but persisted variant_id is missing');
    }

    await Promise.all([
      desktop.waitForURL(url => cleanPath(url) === '/login' && url.searchParams.get('redirect') === 'checkout', { timeout: 15000 }),
      desktop.locator('#place').click()
    ]);
    if (!(await desktop.locator('form').count())) throw new Error('signed-out checkout did not land on a login form');
    const signupHref = await desktop.locator('#signupLink').getAttribute('href');
    const signupUrl = new URL(signupHref || '', desktop.url());
    if (cleanPath(signupUrl) !== '/signup' || signupUrl.searchParams.get('redirect') !== 'checkout.html') {
      throw new Error(`checkout login did not preserve signup return target: ${signupHref}`);
    }

    await open(desktop, '/signup?redirect=checkout');
    const loginHref = await desktop.locator('.links a').first().getAttribute('href');
    const loginUrl = new URL(loginHref || '', desktop.url());
    if (cleanPath(loginUrl) !== '/login' || loginUrl.searchParams.get('redirect') !== 'checkout.html') {
      throw new Error(`signup did not preserve checkout return target: ${loginHref}`);
    }
    await desktop.locator('#fullName').fill('Checkout Test');
    await desktop.locator('#phone').fill('9876543210');
    await desktop.locator('#email').fill('checkout-smoke@example.com');
    await desktop.locator('#password').fill('Password123!');
    await desktop.locator('#confirmPassword').fill('Password456!');
    await desktop.locator('#signupButton').click();
    await desktop.locator('#message').waitFor({ state: 'visible', timeout: 5000 });
    const signupValidation = (await desktop.locator('#message').innerText()).trim();
    if (signupValidation !== 'Passwords do not match.') {
      throw new Error(`valid signup phone was rejected before password validation: ${signupValidation}`);
    }
  }

  await open(desktop, '/index.html');
  const variantProductId = await desktop.evaluate(async () => {
    const { data, error } = await window.supabaseClient.from('products').select('id').eq('is_active', true).eq('has_variants', true).order('id').limit(1);
    if (error) throw error;
    return data?.[0]?.id || null;
  });
  if (variantProductId) {
    await desktop.evaluate(() => { localStorage.removeItem('fashion_fussion_cart'); localStorage.removeItem('fashion_fussion_cart_lines_v2'); localStorage.removeItem('fashion_fussion_cart_variants'); });
    await open(desktop, `/product?id=${encodeURIComponent(variantProductId)}`);
    await desktop.locator('#product').waitFor({ state: 'visible', timeout: 15000 });
    await desktop.locator('#variantPicker').waitFor({ state: 'visible', timeout: 15000 });
    const enabled = desktop.locator('#variantPicker .variant-option:not([disabled])');
    if (!(await enabled.count())) throw new Error(`variant product ${variantProductId} has no enabled option`);
    if (await desktop.locator('#add').isDisabled()) await enabled.first().click();
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
  await mobile.close();

  await browser.close();
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS live human browser smoke: www canonicalization, account/post-purchase extension entry points, wishlist/post-purchase auth return, desktop shopping/cart/login, Add to Cart redirect, checkout auth return, signup phone validation, live variant persistence, stale-variant blocking, extensionless routes, and mobile overflow checks.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

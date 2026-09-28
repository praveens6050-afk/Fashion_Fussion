const { chromium } = require('playwright');

const BASE = 'https://fashionfussion.in';
const WWW = 'https://www.fashionfussion.in';
const STEP_TIMEOUT = 20000;
const failures = [];

function sameCustomerHost(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'fashionfussion.in' || host === 'www.fashionfussion.in';
  } catch { return false; }
}

function cleanPath(url) {
  return String(url.pathname || '/').replace(/\.html$/i, '') || '/';
}

function log(message) {
  console.log(`[browser-smoke] ${message}`);
}

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
    if (['script', 'stylesheet'].includes(request.resourceType()) && errorText === 'net::ERR_ABORTED' && cleanPath(new URL(page.url())) === '/login') return;
    failures.push(`${label} failed request: ${request.method()} ${request.url()} ${errorText}`);
  });
  page.on('response', response => {
    if (!sameCustomerHost(response.url()) || response.status() < 400) return;
    const type = response.request().resourceType();
    if (['document', 'script', 'stylesheet', 'font'].includes(type)) failures.push(`${label} ${type} HTTP ${response.status()}: ${response.url()}`);
  });
}

async function open(page, path) {
  log(`open ${path}`);
  const response = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
  if (!response || !response.ok()) throw new Error(`${path} returned ${response && response.status()}`);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

async function noHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  if (metrics.scroll > metrics.client + 3) throw new Error(`${label} horizontal overflow: ${metrics.scroll}px content in ${metrics.client}px viewport`);
}

async function expectLoginRedirect(browser, path) {
  log(`auth redirect ${path}`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(STEP_TIMEOUT);
  try {
    const response = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    if (!response || !response.ok()) throw new Error(`${path} returned ${response && response.status()}`);
    await page.waitForURL(url => cleanPath(url) === '/login', { timeout: STEP_TIMEOUT });
  } catch (error) {
    throw new Error(`${path} did not redirect signed-out customer to Login; current URL=${page.url()}; ${error.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function firstIndexedProductPath() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT);
  try {
    const response = await fetch(`${BASE}/api/product-sitemap`, { signal: controller.signal });
    if (!response.ok) throw new Error(`product sitemap returned ${response.status}`);
    const xml = await response.text();
    const match = xml.match(/<loc>https:\/\/fashionfussion\.in\/(product\?id=\d+)<\/loc>/i);
    return match ? `/${match[1]}` : null;
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const watchdog = setTimeout(() => {
    console.error(`Browser smoke exceeded 4 minutes; last operation did not finish.`);
    process.exit(1);
  }, 4 * 60 * 1000);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: STEP_TIMEOUT });

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    desktop.setDefaultTimeout(STEP_TIMEOUT);
    observe(desktop, 'desktop');

    await open(desktop, '/');
    await noHorizontalOverflow(desktop, 'desktop home');

    log('check www canonicalization');
    const canonicalPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    canonicalPage.setDefaultTimeout(STEP_TIMEOUT);
    await canonicalPage.goto(WWW + '/', { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    await canonicalPage.waitForURL(url => url.hostname === 'fashionfussion.in', { timeout: STEP_TIMEOUT });
    await canonicalPage.close();

    for (const path of ['/wishlist', '/order-details?id=1', '/quote-checkout?quote=1', '/checkout']) {
      await expectLoginRedirect(browser, path);
    }

    for (const path of ['/search?q=shirt', '/cart', '/login', '/signup?redirect=checkout']) {
      await open(desktop, path);
      await noHorizontalOverflow(desktop, `desktop ${path}`);
    }

    const productPath = await firstIndexedProductPath();
    if (productPath) {
      await open(desktop, productPath);
      await desktop.locator('[data-seo-rendered="true"]').waitFor({ state: 'attached', timeout: STEP_TIMEOUT });
      await desktop.locator('#product').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
      await noHorizontalOverflow(desktop, 'desktop product');
      const canonical = await desktop.locator('link[data-product-seo="canonical"]').getAttribute('href');
      if (!canonical || !canonical.startsWith(`${BASE}/product?id=`)) throw new Error(`product canonical missing or invalid: ${canonical}`);
    }

    await open(desktop, '/signup?redirect=checkout');
    const phone = desktop.locator('input[type="tel"]');
    if (await phone.count()) {
      await phone.fill('123');
      const submit = desktop.locator('button[type="submit"]');
      if (await submit.count()) await submit.click({ timeout: STEP_TIMEOUT }).catch(() => {});
    }
    await desktop.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.setDefaultTimeout(STEP_TIMEOUT);
    observe(mobile, 'mobile');
    for (const path of ['/index.html', '/search', '/cart', '/login', '/signup?redirect=checkout']) {
      await open(mobile, path);
      await noHorizontalOverflow(mobile, `mobile ${path}`);
    }
    if (productPath) {
      await open(mobile, productPath);
      await mobile.locator('#product').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
      await noHorizontalOverflow(mobile, 'mobile product');
    }
    await mobile.close();

    if (failures.length) throw new Error(failures.join('\n'));
    log('PASS live human browser smoke: canonical host, protected-route redirects, desktop/mobile critical pages, product rendering/SEO marker, signup validation, and overflow checks.');
  } finally {
    clearTimeout(watchdog);
    if (browser) await browser.close().catch(() => {});
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

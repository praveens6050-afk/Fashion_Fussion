const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');
const failures = [];

if (!EMAIL || !PASSWORD) throw new Error('SELLER_E2E_EMAIL and SELLER_E2E_PASSWORD are required.');

function cleanPath(value) {
  try { return new URL(value).pathname.replace(/\.html$/i, '') || '/'; }
  catch { return ''; }
}

function observedHost(value) {
  try {
    const host = new URL(value).hostname;
    return host === 'seller.fashionfussion.in' || host.endsWith('.supabase.co');
  } catch { return false; }
}

function observe(page) {
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon/i.test(text)) return;
    if (/cloudflareinsights\.com\/cdn-cgi\/rum/i.test(text)) return;
    failures.push(`console error: ${text}`);
  });
  page.on('requestfailed', request => {
    if (!observedHost(request.url())) return;
    failures.push(`failed request: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('response', response => {
    if (!observedHost(response.url()) || response.status() < 400) return;
    const type = response.request().resourceType();
    if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(type)) {
      failures.push(`${type} HTTP ${response.status()}: ${response.url()}`);
    }
  });
}

async function noHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  if (Math.max(result.scroll, result.body) > result.client + 4) {
    throw new Error(`${label} horizontal overflow: html=${result.scroll}px body=${result.body}px viewport=${result.client}px`);
  }
}

async function physicalClick(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} has no clickable box.`);
  const x = Math.min(Math.max(box.x + box.width / 2, 1), 389);
  const y = Math.min(Math.max(box.y + box.height / 2, 1), 843);
  const hit = await page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    return node ? { id: node.id || '', className: String(node.className || ''), tag: node.tagName } : null;
  }, { x, y });
  if (!hit) throw new Error(`${label} has no hit target at its center.`);
  await page.mouse.click(x, y);
}

async function signIn(page) {
  const response = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error(`Seller mobile login returned ${response && response.status()}`);
  await noHorizontalOverflow(page, 'Seller mobile login');
  await page.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
  await page.locator('#loginEmail').fill(EMAIL);
  await page.locator('#loginPassword').fill(PASSWORD);
  await physicalClick(page, page.locator('#loginSubmit'), 'Seller mobile login button');

  await page.waitForFunction(() => {
    const path = location.pathname.replace(/\.html$/i, '') || '/';
    return !['/login', '/login/'].includes(path);
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.SellerLiveIntegration && window.SellerCatalogBridge) && !document.documentElement.classList.contains('seller-live-loading'), null, { timeout: 20000 });
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#sellerAvatar').waitFor({ state: 'visible', timeout: 10000 });
  const sellerName = ((await page.locator('#sellerDisplayName').textContent()) || '').trim();
  if (!sellerName) throw new Error('Seller mobile dashboard loaded without seller identity text.');
  await noHorizontalOverflow(page, 'Seller mobile dashboard');
  console.log('PASS Seller mobile sign-in and dashboard bootstrap.');
}

async function testVisibleWorkspaces(page) {
  const views = await page.locator('.nav-item[data-view]').evaluateAll(nodes => [...new Set(nodes.filter(node => {
    const style = getComputedStyle(node);
    return !node.hidden && node.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden';
  }).map(node => node.dataset.view).filter(Boolean))]);
  if (!views.length) throw new Error('No visible Seller mobile workspace navigation items found.');

  for (const view of views) {
    const button = page.locator(`.nav-item[data-view="${view}"]`).first();
    await button.scrollIntoViewIfNeeded();
    await button.click({ timeout: 8000 });
    const section = page.locator(`#view-${view}`);
    await section.waitFor({ state: 'visible', timeout: 8000 });
    if (!(await section.evaluate(node => node.classList.contains('active')))) throw new Error(`Seller mobile workspace ${view} did not become active.`);
    if (!(await section.locator('h1,h2').count())) throw new Error(`Seller mobile workspace ${view} has no heading.`);
    await noHorizontalOverflow(page, `Seller mobile ${view}`);
  }

  for (const staged of ['orders', 'returns']) {
    const button = page.locator(`.nav-item[data-view="${staged}"]`).first();
    const section = page.locator(`#view-${staged}`);
    if (await button.isVisible()) throw new Error(`${staged} mobile launch boundary unexpectedly became visible.`);
    if (await section.isVisible()) throw new Error(`${staged} mobile staged workspace unexpectedly became visible.`);
  }

  console.log(`PASS Seller mobile workspace navigation (visible=${views.join(',')}).`);
}

async function signOut(page) {
  const logout = page.locator('#logoutSeller');
  await logout.waitFor({ state: 'visible', timeout: 8000 });
  await physicalClick(page, logout, 'Seller mobile logout button');
  await page.waitForFunction(() => {
    const path = location.pathname.replace(/\.html$/i, '') || '/';
    return ['/login', '/login/'].includes(path);
  }, null, { timeout: 15000 });
  await page.locator('#loginForm').waitFor({ state: 'visible', timeout: 8000 });
  await noHorizontalOverflow(page, 'Seller mobile logged-out page');
  console.log('PASS Seller mobile physical sign-out.');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  observe(page);
  try {
    await signIn(page);
    await testVisibleWorkspaces(page);
    await signOut(page);
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS authenticated Seller mobile E2E: sign-in, responsive workspace navigation, overflow checks, launch boundaries and physical sign-out.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

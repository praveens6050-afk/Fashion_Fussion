const { chromium } = require('playwright');

const BASE = 'https://admin.fashionfussion.in';
const failures = [];

function sameAdminHost(url) {
  try { return new URL(url).hostname === 'admin.fashionfussion.in'; }
  catch { return false; }
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
    if (!sameAdminHost(request.url())) return;
    failures.push(`${label} failed request: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('response', response => {
    if (!sameAdminHost(response.url()) || response.status() < 400) return;
    const type = response.request().resourceType();
    if (['document', 'script', 'stylesheet', 'font'].includes(type)) {
      failures.push(`${label} ${type} HTTP ${response.status()}: ${response.url()}`);
    }
  });
}

async function open(page, path) {
  const response = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error(`${path} returned ${response && response.status()}`);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

async function noHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  if (metrics.scroll > metrics.client + 3) {
    throw new Error(`${label} horizontal overflow: ${metrics.scroll}px content in ${metrics.client}px viewport`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  observe(desktop, 'admin desktop');
  await open(desktop, '/login');
  for (const selector of ['#form', '#email', '#password', '#passwordToggle', '#submit', '#forgot']) {
    if (!(await desktop.locator(selector).count())) throw new Error(`Admin login missing ${selector}`);
  }
  await noHorizontalOverflow(desktop, 'Admin desktop login');

  await desktop.locator('#password').fill('human-smoke-password');
  await desktop.locator('#passwordToggle').click();
  if ((await desktop.locator('#password').getAttribute('type')) !== 'text') throw new Error('Admin password Show control did not reveal password');
  await desktop.locator('#passwordToggle').click();
  if ((await desktop.locator('#password').getAttribute('type')) !== 'password') throw new Error('Admin password Hide control did not restore password field');

  await desktop.locator('#email').fill('');
  await desktop.locator('#forgot').click();
  await desktop.locator('#banner').waitFor({ state: 'visible', timeout: 5000 });
  if (!/administrator email address/i.test(await desktop.locator('#banner').innerText())) {
    throw new Error('Admin forgot-password empty-email validation message is missing');
  }

  await open(desktop, '/admin');
  await desktop.locator('#accessDenied:not([hidden])').waitFor({ state: 'visible', timeout: 15000 });
  const denied = await desktop.locator('#accessDeniedMessage').innerText();
  if (!/sign in|administrator/i.test(denied)) throw new Error(`Unexpected signed-out Admin guard message: ${denied}`);
  if (await desktop.locator('#dashboard').isVisible()) throw new Error('Admin dashboard became visible without an authenticated administrator session');
  await noHorizontalOverflow(desktop, 'Admin signed-out dashboard guard');

  await Promise.all([
    desktop.waitForURL(url => /\/login(?:\.html)?$/.test(url.pathname), { timeout: 10000 }),
    desktop.locator('#goToLoginButton').click()
  ]);

  await open(desktop, '/reset-password');
  if (!(await desktop.locator('form').count())) throw new Error('Admin reset-password page has no form');
  await noHorizontalOverflow(desktop, 'Admin reset-password');
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  observe(mobile, 'admin mobile');
  for (const path of ['/login', '/reset-password', '/admin-account']) {
    await open(mobile, path);
    await noHorizontalOverflow(mobile, `Admin mobile ${path}`);
  }
  await mobile.close();

  await browser.close();
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS live Admin human browser smoke: login controls, password visibility, forgot-password validation, signed-out dashboard guard, reset-password, network resources and mobile overflow.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

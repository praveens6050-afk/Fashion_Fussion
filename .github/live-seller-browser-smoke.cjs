const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const failures = [];

function sameSellerHost(url) {
  try { return new URL(url).hostname === 'seller.fashionfussion.in'; }
  catch { return false; }
}

function cleanPath(url) {
  return String(url.pathname || '/').replace(/\.html$/i, '') || '/';
}

function expectedAuthRedirectAbort(request) {
  const failure = request.failure()?.errorText || '';
  try {
    const url = new URL(request.url());
    return /ERR_ABORTED/i.test(failure) && url.hostname === 'seller.fashionfussion.in' && /\/(?:app|portal|supabase-config)\.js$/i.test(url.pathname);
  } catch { return false; }
}

function observe(page, label) {
  let signedOutRedirectInProgress = false;
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
    if (!sameSellerHost(request.url())) return;
    const failure = request.failure()?.errorText || '';
    if (signedOutRedirectInProgress && request.resourceType() === 'script' && /ERR_ABORTED/i.test(failure)) return;
    if (expectedAuthRedirectAbort(request)) return;
    failures.push(`${label} failed request: ${request.method()} ${request.url()} ${failure}`);
  });
  page.on('response', response => {
    if (!sameSellerHost(response.url()) || response.status() < 400) return;
    const type = response.request().resourceType();
    if (['document', 'script', 'stylesheet', 'font'].includes(type)) {
      failures.push(`${label} ${type} HTTP ${response.status()}: ${response.url()}`);
    }
  });
  return {
    beginSignedOutRedirect() { signedOutRedirectInProgress = true; },
    endSignedOutRedirect() { signedOutRedirectInProgress = false; }
  };
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
  const desktopObserver = observe(desktop, 'seller desktop');
  await open(desktop, '/login');
  for (const selector of ['#loginForm', '#loginEmail', '#loginPassword', '#loginSubmit', '#forgotPassword', '#loginTab', '#registerTab']) {
    if (!(await desktop.locator(selector).count())) throw new Error(`Seller login missing ${selector}`);
  }
  await desktop.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
  await noHorizontalOverflow(desktop, 'Seller desktop login');

  await desktop.locator('#loginPassword').fill('human-smoke-password');
  const toggle = desktop.locator('[data-password-toggle="loginPassword"]');
  await toggle.click();
  if ((await desktop.locator('#loginPassword').getAttribute('type')) !== 'text') throw new Error('Seller password Show control did not reveal password');
  await toggle.click();
  if ((await desktop.locator('#loginPassword').getAttribute('type')) !== 'password') throw new Error('Seller password Hide control did not restore password field');

  await desktop.locator('#loginEmail').fill('');
  await desktop.locator('#forgotPassword').click();
  await desktop.waitForFunction(() => /registered seller email/i.test(document.querySelector('#authMessage')?.textContent || ''), null, { timeout: 5000 });

  await desktop.locator('#registerTab').click();
  if (!(await desktop.locator('#registerForm').isVisible())) throw new Error('Seller Create account tab did not reveal registration form');
  if (await desktop.locator('#loginForm').isVisible()) throw new Error('Seller login form stayed visible while registration tab is active');
  for (const selector of ['#firstName', '#lastName', '#storeName', '#registerEmail', '#mobile', '#registerPassword', '#sellerType', '#termsAccepted', '#registerSubmit']) {
    if (!(await desktop.locator(selector).count())) throw new Error(`Seller registration missing ${selector}`);
  }
  await noHorizontalOverflow(desktop, 'Seller desktop registration');

  await open(desktop, '/login?recovery=1');
  if (!(await desktop.locator('#resetPasswordForm').isVisible())) throw new Error('Seller recovery URL did not reveal reset-password form');
  if (await desktop.locator('.auth-tabs').isVisible()) throw new Error('Seller recovery mode left login/register tabs visible');
  await noHorizontalOverflow(desktop, 'Seller recovery');

  desktopObserver.beginSignedOutRedirect();
  try {
    await desktop.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await desktop.waitForURL(url => cleanPath(url) === '/login', { timeout: 15000 });
    await desktop.locator('#loginForm').waitFor({ state: 'attached', timeout: 10000 });
    await desktop.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  } finally {
    desktopObserver.endSignedOutRedirect();
  }
  if (!(await desktop.locator('#loginForm').count())) throw new Error('Signed-out Seller dashboard did not redirect to Seller login');
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  observe(mobile, 'seller mobile');
  await open(mobile, '/login');
  await mobile.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
  await noHorizontalOverflow(mobile, 'Seller mobile login');
  await mobile.locator('#registerTab').click();
  await noHorizontalOverflow(mobile, 'Seller mobile registration');
  await mobile.close();

  await browser.close();
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS live Seller human browser smoke: authentication startup, password visibility, forgot-password validation, registration/recovery UI, signed-out dashboard guard, network resources and mobile overflow.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');
if (!EMAIL || !PASSWORD) throw new Error('Seller E2E credentials are required.');

function urlState(value) {
  try {
    const url = new URL(value);
    return {
      path: url.pathname.replace(/\.html$/i, '') || '/',
      search: url.search || '',
      safe: `${url.pathname}${url.search}`
    };
  } catch {
    return { path: '', search: '', safe: '' };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bounded(label, promise, timeoutMs = 1200) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}-timeout-${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);

  const browserErrors = [];
  const navigations = [];

  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const current = urlState(frame.url());
    navigations.push(current.safe);
    console.log(`MAIN_NAV ${current.safe || '(empty)'}`);
  });
  page.on('close', () => console.log('PAGE_CLOSED'));
  page.on('crash', () => console.log('PAGE_CRASHED'));
  page.on('pageerror', error => browserErrors.push(`pageerror:${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon|cloudflareinsights\.com\/cdn-cgi\/rum/i.test(text)) return;
    browserErrors.push(`console:${text}`);
  });
  page.on('requestfailed', request => {
    try {
      const u = new URL(request.url());
      if (u.hostname === 'seller.fashionfussion.in' || u.hostname.endsWith('.supabase.co')) {
        browserErrors.push(`request:${request.method()} ${u.origin}${u.pathname} ${request.failure()?.errorText || ''}`);
      }
    } catch {}
  });

  try {
    console.log('START Seller dashboard bootstrap navigation diagnostic.');
    const loginResponse = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!loginResponse || !loginResponse.ok()) throw new Error(`Seller login returned ${loginResponse && loginResponse.status()}`);
    await page.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);

    const button = page.locator('#loginSubmit');
    const box = await button.boundingBox();
    if (!box) throw new Error('Seller login button is not clickable.');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const handoffDeadline = Date.now() + 30000;
    while (Date.now() < handoffDeadline) {
      const current = urlState(page.url());
      if (!['/login', '/login/'].includes(current.path)) break;
      const message = await page.locator('#authMessage').textContent({ timeout: 400 }).catch(() => '');
      if (message && !/^signing in/i.test(message.trim())) throw new Error(`Seller login failed: ${message.trim()}`);
      await sleep(150);
    }

    let current = urlState(page.url());
    if (['/login', '/login/'].includes(current.path)) throw new Error(`Seller login handoff remained on ${current.safe || '/login'}`);
    console.log(`PASS Seller UI login handoff: ${current.safe}`);

    let lastState = null;
    for (let i = 1; i <= 40; i++) {
      current = urlState(page.url());
      if (['/login', '/login/'].includes(current.path)) {
        console.error(`BOOTSTRAP_BOUNCE_TO_LOGIN ${current.safe}`);
        throw new Error(`Seller dashboard bounced back to login${current.search ? ` (${current.search})` : ''}`);
      }

      try {
        lastState = await bounded(`sample-${i}`, page.evaluate(() => ({
          path: location.pathname,
          search: location.search,
          readyState: document.readyState,
          readyPromise: Boolean(window.ffSellerSupabaseReady),
          supabaseSdk: Boolean(window.supabase?.createClient),
          supabaseClient: Boolean(window.supabaseClient),
          liveIntegration: Boolean(window.SellerLiveIntegration),
          catalogBridge: Boolean(window.SellerCatalogBridge),
          integrationBooted: Boolean(window.__sellerLiveIntegrationBooted),
          loadingClass: document.documentElement.classList.contains('seller-live-loading'),
          shellExists: Boolean(document.querySelector('.shell')),
          shellVisible: Boolean(document.querySelector('.shell')) && getComputedStyle(document.querySelector('.shell')).visibility !== 'hidden',
          profileEmailExists: Boolean(document.getElementById('profileEmail')),
          recoveryScript: Boolean(document.querySelector('script[data-seller-live-recovery]')),
          launchSafetyScript: Boolean(document.querySelector('script[data-seller-launch-safety]'))
        })), 1200);
        console.log(`BOOTSTRAP_SAMPLE_${i} ${JSON.stringify(lastState)}`);
      } catch (error) {
        current = urlState(page.url());
        console.log(`BOOTSTRAP_SAMPLE_${i}_EVAL_ERROR path=${current.safe || '(empty)'} error=${String(error?.message || error).slice(0, 240)}`);
        if (['/login', '/login/'].includes(current.path)) {
          throw new Error(`Seller dashboard bounced back to login${current.search ? ` (${current.search})` : ''}`);
        }
        if (page.isClosed()) throw new Error('Seller dashboard page closed during bootstrap.');
      }

      if (lastState?.liveIntegration && lastState?.catalogBridge && !lastState?.loadingClass) {
        console.log('PASS Seller dashboard bootstrap diagnostic.');
        return;
      }

      await sleep(500);
    }

    current = urlState(page.url());
    console.error(`BOOTSTRAP_FAILURE path=${current.safe || '(empty)'} state=${JSON.stringify(lastState)}`);
    console.error(`BOOTSTRAP_NAV_HISTORY ${JSON.stringify(navigations.slice(-20))}`);
    if (browserErrors.length) console.error(`BOOTSTRAP_BROWSER_ERRORS ${JSON.stringify(browserErrors.slice(-20))}`);
    throw new Error('Seller dashboard bootstrap did not become ready within diagnostic window.');
  } finally {
    await Promise.race([
      browser.close().catch(() => {}),
      sleep(3000)
    ]);
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

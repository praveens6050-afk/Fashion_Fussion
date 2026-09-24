const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');

if (!EMAIL || !PASSWORD) throw new Error('Seller E2E credentials are required.');

function cleanPath(value) {
  try { return new URL(value).pathname.replace(/\.html$/i, '') || '/'; }
  catch { return ''; }
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value || '').slice(0, 180);
  }
}

async function mouseClick(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} is not clickable.`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];

  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon|cloudflareinsights\.com\/cdn-cgi\/rum/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.hostname !== 'seller.fashionfussion.in' && !url.hostname.endsWith('.supabase.co')) return;
    errors.push(`requestfailed: ${request.method()} ${safeUrl(request.url())} ${request.failure()?.errorText || ''}`);
  });

  try {
    console.log('START Seller UI login handoff diagnostic.');
    const response = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response || !response.ok()) throw new Error(`Seller login returned ${response && response.status()}`);
    await page.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);
    await mouseClick(page, page.locator('#loginSubmit'), 'Seller login button');

    await page.waitForFunction(() => {
      const path = location.pathname.replace(/\.html$/i, '') || '/';
      if (!['/login', '/login/'].includes(path)) return true;
      const message = (document.getElementById('authMessage')?.textContent || '').trim();
      return Boolean(message && !/^signing in/i.test(message));
    }, null, { timeout: 30000 });

    const path = cleanPath(page.url());
    if (['/login', '/login/'].includes(path)) {
      const message = ((await page.locator('#authMessage').textContent({ timeout: 1000 }).catch(() => '')) || '').trim();
      throw new Error(`Seller login handoff failed${message ? `: ${message}` : ''}`);
    }
    console.log(`PASS Seller UI login handoff: ${path}`);

    let ready = false;
    for (let i = 0; i < 25; i++) {
      ready = await page.evaluate(() => Boolean(window.SellerLiveIntegration && window.SellerCatalogBridge) && !document.documentElement.classList.contains('seller-live-loading')).catch(() => false);
      if (ready) break;
      await page.waitForTimeout(1000);
    }

    const state = await page.evaluate(async () => {
      let supabaseReady = 'missing';
      if (window.ffSellerSupabaseReady) {
        try {
          await Promise.race([
            window.ffSellerSupabaseReady,
            new Promise((_, reject) => setTimeout(() => reject(new Error('__pending__')), 1200))
          ]);
          supabaseReady = 'resolved';
        } catch (error) {
          supabaseReady = error?.message === '__pending__' ? 'pending' : `rejected:${String(error?.message || error).slice(0, 180)}`;
        }
      }
      const shell = document.querySelector('.shell');
      return {
        path: location.pathname,
        readyState: document.readyState,
        loadingClass: document.documentElement.classList.contains('seller-live-loading'),
        hasSupabaseSdk: Boolean(window.supabase?.createClient),
        hasSupabaseClient: Boolean(window.supabaseClient),
        supabaseReady,
        hasSellerLiveIntegration: Boolean(window.SellerLiveIntegration),
        hasSellerCatalogBridge: Boolean(window.SellerCatalogBridge),
        liveIntegrationBooted: Boolean(window.__sellerLiveIntegrationBooted),
        liveRecoveryScript: Boolean(document.querySelector('script[data-seller-live-recovery]')),
        launchSafetyScript: Boolean(document.querySelector('script[data-seller-launch-safety]')),
        liveIntegrationScripts: [...document.querySelectorAll('script[src*="seller-live-integration.js"]')].map(node => node.getAttribute('src')),
        shellPresent: Boolean(shell),
        shellVisibility: shell ? getComputedStyle(shell).visibility : 'missing',
        displayNamePresent: Boolean(document.getElementById('sellerDisplayName')),
        profileEmailPresent: Boolean(document.getElementById('profileEmail')),
        localSessionMarker: Boolean(localStorage.getItem('ff_seller_session_v1')),
        sessionSessionMarker: Boolean(sessionStorage.getItem('ff_seller_session_v1'))
      };
    });

    console.log(`SAFE_BOOTSTRAP_STATE ${JSON.stringify(state)}`);
    if (errors.length) console.log(`SAFE_BROWSER_ERRORS ${JSON.stringify(errors.slice(0, 12))}`);
    if (!ready) throw new Error('Seller dashboard bootstrap did not become ready within 25 seconds.');
    console.log('PASS Seller dashboard bootstrap diagnostic.');
  } finally {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

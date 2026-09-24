const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');
if (!EMAIL || !PASSWORD) throw new Error('Seller E2E credentials are required.');

function cleanPath(value) {
  try { return new URL(value).pathname.replace(/\.html$/i, '') || '/'; }
  catch { return ''; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(`pageerror:${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
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
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);
    const button = page.locator('#loginSubmit');
    const box = await button.boundingBox();
    if (!box) throw new Error('Seller login button is not clickable.');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => !['/login', '/login/'].includes((location.pathname.replace(/\.html$/i, '') || '/')), null, { timeout: 30000 });

    let state = null;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1500);
      state = await page.evaluate(async () => {
        let authSession = false;
        let authError = null;
        try {
          const client = window.supabaseClient || (window.ffSellerSupabaseReady ? await Promise.race([
            window.ffSellerSupabaseReady,
            new Promise((_, reject) => setTimeout(() => reject(new Error('ready-timeout')), 1000))
          ]) : null);
          if (client) {
            const result = await Promise.race([
              client.auth.getSession(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('session-timeout')), 1000))
            ]);
            authSession = Boolean(result?.data?.session?.user);
            authError = result?.error?.message || null;
          }
        } catch (error) {
          authError = error?.message || String(error);
        }
        return {
          path: location.pathname,
          readyPromise: Boolean(window.ffSellerSupabaseReady),
          supabaseClient: Boolean(window.supabaseClient),
          liveIntegration: Boolean(window.SellerLiveIntegration),
          catalogBridge: Boolean(window.SellerCatalogBridge),
          integrationBooted: Boolean(window.__sellerLiveIntegrationBooted),
          loadingClass: document.documentElement.classList.contains('seller-live-loading'),
          shellExists: Boolean(document.querySelector('.shell')),
          profileEmailExists: Boolean(document.getElementById('profileEmail')),
          authSession,
          authError
        };
      });
      console.log(`BOOTSTRAP_STATE_${i + 1} ${JSON.stringify(state)}`);
      if (state.liveIntegration && state.catalogBridge && !state.loadingClass) {
        console.log('PASS Seller dashboard bootstrap diagnostic.');
        process.exitCode = 0;
        return;
      }
      if (['/login', '/login/'].includes(cleanPath(page.url()))) break;
    }

    console.error(`BOOTSTRAP_FAILURE ${JSON.stringify(state)}`);
    if (browserErrors.length) console.error(`BOOTSTRAP_BROWSER_ERRORS ${JSON.stringify(browserErrors.slice(-20))}`);
    process.exitCode = 1;
  } finally {
    await Promise.race([browser.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

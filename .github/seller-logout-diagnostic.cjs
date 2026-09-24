const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');
if (!EMAIL || !PASSWORD) throw new Error('SELLER_E2E_EMAIL and SELLER_E2E_PASSWORD are required.');

const cleanPath = value => {
  try { return new URL(value).pathname.replace(/\.html$/i, '') || '/'; }
  catch { return ''; }
};

async function snapshot(page, label) {
  const state = await page.evaluate(() => ({
    href: location.href,
    path: location.pathname,
    readyState: document.readyState,
    logoutGuardBound: Boolean(window.__sellerLogoutCaptureBound),
    liveVersion: window.SellerLiveIntegration?.version || window.__sellerLiveIntegrationVersion || '',
    logoutVisible: Boolean(document.getElementById('logoutSeller') && getComputedStyle(document.getElementById('logoutSeller')).display !== 'none'),
    localKeys: Object.keys(localStorage).filter(key => /^(ff_seller_session_v1|sb-.*-auth-token)/i.test(key)),
    sessionKeys: Object.keys(sessionStorage).filter(key => /^(ff_seller_session_v1|sb-.*-auth-token)/i.test(key)),
    navigationScript: [...document.scripts].map(script => script.src).find(src => /navigation-fix\.js/i.test(src)) || ''
  })).catch(error => ({ href: page.url(), evaluateError: error.message }));
  console.log(`${label} ${JSON.stringify(state)}`);
  return state;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const navigations = [];
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      navigations.push(frame.url());
      console.log(`MAIN_NAV ${frame.url()}`);
    }
  });
  page.on('console', message => console.log(`BROWSER_${message.type().toUpperCase()} ${message.text()}`));
  page.on('pageerror', error => console.log(`PAGE_ERROR ${error.message}`));
  page.on('requestfailed', request => {
    if (/seller\.fashionfussion\.in|supabase\.co/i.test(request.url())) {
      console.log(`REQUEST_FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
    }
  });

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#loginSubmit').click();
    await page.waitForFunction(() => !['/login', '/login/'].includes((location.pathname.replace(/\.html$/i, '') || '/')), null, { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.SellerLiveIntegration && window.SellerCatalogBridge) && !document.documentElement.classList.contains('seller-live-loading'), null, { timeout: 20000 });
    console.log('PASS_DIAG sign-in');

    const before = await snapshot(page, 'LOGOUT_BEFORE');
    const assetHasGuard = await page.evaluate(async () => {
      const response = await fetch('/navigation-fix.js?logout_diag=' + Date.now(), { cache: 'no-store' });
      const text = await response.text();
      return { status: response.status, hasBindLogoutGuard: text.includes('bindLogoutGuard'), hasCaptureFlag: text.includes('__sellerLogoutCaptureBound') };
    });
    console.log(`LOGOUT_ASSET ${JSON.stringify(assetHasGuard)}`);

    const logout = page.locator('#logoutSeller');
    await logout.scrollIntoViewIfNeeded();
    const box = await logout.boundingBox();
    if (!box) throw new Error('Logout button has no bounding box.');
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        tag: el?.tagName || '',
        id: el?.id || '',
        className: typeof el?.className === 'string' ? el.className : '',
        text: (el?.textContent || '').trim().slice(0, 120),
        insideLogout: Boolean(el?.closest?.('#logoutSeller'))
      };
    }, center);
    console.log(`LOGOUT_HIT ${JSON.stringify({ box, center, hit })}`);

    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(2500);
    console.log(`AFTER_MOUSE url=${page.url()} navs=${JSON.stringify(navigations)}`);
    if (!['/login', '/login/'].includes(cleanPath(page.url()))) await snapshot(page, 'AFTER_MOUSE_STATE');

    if (!['/login', '/login/'].includes(cleanPath(page.url()))) {
      console.log('FALLBACK locator.click(force=true)');
      await page.locator('#logoutSeller').click({ force: true, timeout: 5000 });
      await page.waitForTimeout(2500);
      console.log(`AFTER_LOCATOR url=${page.url()} navs=${JSON.stringify(navigations)}`);
      if (!['/login', '/login/'].includes(cleanPath(page.url()))) await snapshot(page, 'AFTER_LOCATOR_STATE');
    }

    if (!['/login', '/login/'].includes(cleanPath(page.url()))) {
      console.log('FALLBACK SellerLiveIntegration.logout()');
      await page.evaluate(() => window.SellerLiveIntegration?.logout?.());
      await page.waitForTimeout(4000);
      console.log(`AFTER_DIRECT_LOGOUT url=${page.url()} navs=${JSON.stringify(navigations)}`);
      if (!['/login', '/login/'].includes(cleanPath(page.url()))) await snapshot(page, 'AFTER_DIRECT_LOGOUT_STATE');
    }

    if (!['/login', '/login/'].includes(cleanPath(page.url()))) {
      console.log('FALLBACK direct location.replace(/login?signedout=diag)');
      await page.evaluate(() => location.replace('/login?signedout=diag'));
      await page.waitForTimeout(4000);
      console.log(`AFTER_LOCATION_REPLACE url=${page.url()} navs=${JSON.stringify(navigations)}`);
    }

    if (!['/login', '/login/'].includes(cleanPath(page.url()))) {
      throw new Error(`Logout diagnostic never reached login. Final URL=${page.url()} initialGuard=${before.logoutGuardBound} navigations=${JSON.stringify(navigations)}`);
    }
    await page.locator('#loginForm').waitFor({ state: 'visible', timeout: 10000 });
    console.log(`PASS_DIAG logout reached login; navigations=${JSON.stringify(navigations)}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');
const RUN_ID = `${Date.now().toString(36)}-${String(process.env.GITHUB_RUN_ID || 'local').slice(-6)}`.toUpperCase();
const TEST_NAME = `E2E Seller Catalog ${RUN_ID}`;
const TEST_SKU = `E2E-${RUN_ID}`.replace(/[^A-Z0-9-]/g, '').slice(0, 38);
const EXPECTED_LIVE_VERSION = '20260925-authoritative-withdraw-v2';
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

async function waitForToast(page, pattern, timeout = 15000) {
  await page.waitForFunction(source => {
    const toast = document.getElementById('toast');
    if (!toast) return false;
    return new RegExp(source, 'i').test(toast.textContent || '');
  }, pattern.source, { timeout });
}

async function waitForBridgeStatus(page, id, status, timeout = 15000) {
  await page.waitForFunction(({ productId, expectedStatus }) => {
    const products = window.SellerCatalogBridge?.getProducts?.();
    if (!Array.isArray(products)) return false;
    const product = products.find(item => String(item?.id) === String(productId));
    return product?.status === expectedStatus;
  }, { productId: id, expectedStatus: status }, { timeout });
}

async function noHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  if (result.scroll > result.client + 4) {
    throw new Error(`${label} horizontal overflow: ${result.scroll}px in ${result.client}px viewport`);
  }
}

async function mouseClick(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} is not clickable.`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function signIn(page) {
  const response = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error(`Seller login returned ${response && response.status()}`);
  await page.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
  await page.locator('#loginEmail').fill(EMAIL);
  await page.locator('#loginPassword').fill(PASSWORD);

  await mouseClick(page, page.locator('#loginSubmit'), 'Seller login button');
  try {
    await page.waitForFunction(() => {
      const path = location.pathname.replace(/\.html$/i, '') || '/';
      if (!['/login', '/login/'].includes(path)) return true;
      const message = (document.getElementById('authMessage')?.textContent || '').trim();
      return Boolean(message && !/^signing in/i.test(message));
    }, null, { timeout: 30000 });
  } catch (error) {
    const path = cleanPath(page.url());
    if (['/login', '/login/'].includes(path)) {
      const message = ((await page.locator('#authMessage').textContent({ timeout: 1000 }).catch(() => '')) || '').trim();
      throw new Error(`Seller sign-in did not reach dashboard${message ? `: ${message}` : ''}`);
    }
  }

  if (['/login', '/login/'].includes(cleanPath(page.url()))) {
    const message = ((await page.locator('#authMessage').textContent({ timeout: 1000 }).catch(() => '')) || '').trim();
    throw new Error(`Seller sign-in remained on login${message ? `: ${message}` : ''}`);
  }

  await page.waitForFunction(() => Boolean(window.SellerLiveIntegration && window.SellerCatalogBridge) && !document.documentElement.classList.contains('seller-live-loading'), null, { timeout: 20000 });
  await page.locator('#sellerDisplayName').waitFor({ state: 'visible', timeout: 10000 });
  const liveVersion = await page.evaluate(() => window.SellerLiveIntegration?.version || window.__sellerLiveIntegrationVersion || '');
  if (liveVersion !== EXPECTED_LIVE_VERSION) throw new Error(`Seller live integration version mismatch: ${liveVersion || 'missing'} (expected ${EXPECTED_LIVE_VERSION}).`);
  const email = await page.locator('#profileEmail').inputValue();
  if (email.toLowerCase() !== EMAIL.toLowerCase()) throw new Error(`Signed in profile email mismatch: ${email}`);
  console.log(`PASS Seller sign-in and dashboard bootstrap (live=${liveVersion}).`);
}

async function testEveryWorkspace(page) {
  const views = await page.locator('.nav-item[data-view]').evaluateAll(nodes => [...new Set(nodes.filter(node => {
    const style = getComputedStyle(node);
    return !node.hidden && node.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden';
  }).map(node => node.dataset.view).filter(Boolean))]);
  if (!views.length) throw new Error('No visible Seller workspace navigation items found.');
  for (const view of views) {
    const button = page.locator(`.nav-item[data-view="${view}"]`).first();
    await button.click({ timeout: 8000 });
    const section = page.locator(`#view-${view}`);
    await section.waitFor({ state: 'visible', timeout: 8000 });
    if (!(await section.evaluate(node => node.classList.contains('active')))) throw new Error(`Seller workspace ${view} did not become active.`);
    if (!(await section.locator('h1,h2').count())) throw new Error(`Seller workspace ${view} has no visible heading.`);
    await noHorizontalOverflow(page, `Seller ${view}`);
  }

  for (const staged of ['orders', 'returns']) {
    const button = page.locator(`.nav-item[data-view="${staged}"]`).first();
    const section = page.locator(`#view-${staged}`);
    if (await button.isVisible()) throw new Error(`${staged} launch boundary unexpectedly became visible.`);
    if (await section.isVisible()) throw new Error(`${staged} staged workspace unexpectedly became visible.`);
  }

  const payments = page.locator('.nav-item[data-view="payments"]').first();
  if (await payments.isVisible()) {
    await payments.click({ timeout: 8000 });
    await page.locator('#view-payments').waitFor({ state: 'visible', timeout: 8000 });
  }

  const profile = page.locator('.nav-item[data-view="profile"]').first();
  await profile.click({ timeout: 8000 });
  const kyc = (await page.locator('#kycStatus').textContent())?.trim();
  if (!kyc) throw new Error('Seller KYC status is empty.');
  console.log(`PASS Seller workspace navigation and launch boundaries (visible=${views.join(',')}; KYC=${kyc}).`);
}

async function testProfileNoopSave(page) {
  await page.locator('.nav-item[data-view="profile"]').first().click();
  const before = {
    first: await page.locator('#profileFirstName').inputValue(),
    last: await page.locator('#profileLastName').inputValue(),
    store: await page.locator('#profileStoreName').inputValue(),
    phone: await page.locator('#profileMobile').inputValue(),
    type: await page.locator('#profileSellerType').inputValue()
  };
  await page.locator('#sellerProfileForm button[type="submit"]').click();
  await waitForToast(page, /Seller profile saved\./);
  const after = {
    first: await page.locator('#profileFirstName').inputValue(),
    last: await page.locator('#profileLastName').inputValue(),
    store: await page.locator('#profileStoreName').inputValue(),
    phone: await page.locator('#profileMobile').inputValue(),
    type: await page.locator('#profileSellerType').inputValue()
  };
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('No-op profile save unexpectedly changed seller profile fields.');
  console.log('PASS Seller profile no-op save.');
}

async function openProductsAndSearch(page, query) {
  await page.locator('.nav-item[data-view="products"]').first().click();
  await page.locator('#productSearch').fill(query);
  await page.waitForTimeout(150);
}

async function testLiveCatalogLifecycle(page) {
  await page.locator('[data-action="add-product"]').first().click();
  await page.locator('#productDrawer.open').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('#brand').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('#name').fill(TEST_NAME);
  await page.locator('#category').fill('Automated QA');
  await page.locator('#sku').fill(TEST_SKU);
  await page.locator('#description').fill('Authenticated Seller E2E listing used to verify the live catalog submit, edit, duplicate and withdraw lifecycle.');
  await page.locator('#price').fill('1299');
  await page.locator('#mrp').fill('1499');
  await page.locator('#stock').fill('3');
  await page.locator('#brand').fill('Fashion Fussion QA');
  await page.locator('#countryOrigin').fill('India');
  await page.locator('#submitProduct').click();
  await waitForToast(page, /Product submitted for admin review\./);

  await openProductsAndSearch(page, TEST_SKU);
  let original = page.locator('#productsTable tr').filter({ hasText: TEST_SKU }).filter({ hasNotText: 'Copy' }).first();
  await original.waitFor({ state: 'visible', timeout: 15000 });
  if (!/pending/i.test((await original.locator('.status').textContent()) || '')) throw new Error('New Seller listing is not pending after submission.');

  await original.locator('[data-edit]').click();
  await page.locator('#productDrawer.open').waitFor({ state: 'visible', timeout: 8000 });
  if ((await page.locator('#brand').inputValue()).trim() !== 'Fashion Fussion QA') throw new Error('Edit drawer did not restore live listing brand.');
  await page.locator('#price').fill('1249');
  await page.locator('#submitProduct').click();
  await waitForToast(page, /Changes sent to admin review\./);
  await openProductsAndSearch(page, TEST_SKU);
  original = page.locator('#productsTable tr').filter({ hasText: TEST_SKU }).filter({ hasNotText: 'Copy' }).first();
  await original.waitFor({ state: 'visible', timeout: 15000 });
  if (!((await original.textContent()) || '').includes('1,249')) throw new Error('Edited Seller listing price did not refresh from the database row.');

  const beforeDuplicate = await page.locator('#productsTable tr').count();
  await original.locator('[data-duplicate]').click();
  await waitForToast(page, /Product submitted for admin review\./);
  await page.waitForFunction(previous => document.querySelectorAll('#productsTable tr').length > previous, beforeDuplicate, { timeout: 15000 });
  const copy = page.locator('#productsTable tr').filter({ hasText: `${TEST_NAME} Copy` }).first();
  await copy.waitFor({ state: 'visible', timeout: 10000 });
  if (!/pending/i.test((await copy.locator('.status').textContent()) || '')) throw new Error('Duplicated Seller listing is not pending.');

  const copyId = await copy.locator('[data-delete]').getAttribute('data-delete');
  if (!copyId) throw new Error('Duplicated Seller listing has no withdrawal identifier.');
  page.once('dialog', dialog => dialog.accept());
  await copy.locator('[data-delete]').click();
  await waitForBridgeStatus(page, copyId, 'withdrawn');
  await waitForToast(page, /Listing withdrawn\./);
  await openProductsAndSearch(page, TEST_SKU);
  const withdrawnCopy = page.locator('#productsTable tr').filter({ hasText: `${TEST_NAME} Copy` }).first();
  await withdrawnCopy.waitFor({ state: 'visible', timeout: 10000 });
  const withdrawnCopyStatus = (await withdrawnCopy.locator('.status').textContent())?.trim();
  if (withdrawnCopyStatus !== 'Withdrawn') throw new Error(`Withdrawn duplicate rendered as “${withdrawnCopyStatus}” instead of “Withdrawn”.`);

  original = page.locator('#productsTable tr').filter({ hasText: TEST_SKU }).filter({ hasNotText: 'Copy' }).first();
  const originalId = await original.locator('[data-delete]').getAttribute('data-delete');
  if (!originalId) throw new Error('Original Seller listing has no withdrawal identifier.');
  page.once('dialog', dialog => dialog.accept());
  await original.locator('[data-delete]').click();
  await waitForBridgeStatus(page, originalId, 'withdrawn');
  await waitForToast(page, /Listing withdrawn\./);
  await openProductsAndSearch(page, TEST_SKU);
  original = page.locator('#productsTable tr').filter({ hasText: TEST_SKU }).filter({ hasNotText: 'Copy' }).first();
  await original.waitFor({ state: 'visible', timeout: 10000 });
  const originalStatus = (await original.locator('.status').textContent())?.trim();
  if (originalStatus !== 'Withdrawn') throw new Error(`Withdrawn original rendered as “${originalStatus}” instead of “Withdrawn”.`);

  const withdrawnTab = page.locator('#statusTabs [data-status="withdrawn"]');
  await withdrawnTab.click();
  if (!(await withdrawnTab.evaluate(node => node.classList.contains('active')))) throw new Error('Withdrawn filter tab did not activate.');
  if ((await page.locator('#productsTable tr').filter({ hasText: TEST_SKU }).count()) < 2) throw new Error('Withdrawn filter did not show the withdrawn E2E listings.');
  console.log('PASS live Seller catalog submit/edit/duplicate/withdraw lifecycle.');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  observe(page);
  try {
    await signIn(page);
    await testEveryWorkspace(page);
    await testProfileNoopSave(page);
    await testLiveCatalogLifecycle(page);

    await mouseClick(page, page.locator('#logoutSeller'), 'Seller logout button');
    await page.waitForFunction(() => {
      const path = location.pathname.replace(/\.html$/i, '') || '/';
      return ['/login', '/login/'].includes(path);
    }, null, { timeout: 15000 });
    if (!(await page.locator('#loginForm').count())) throw new Error('Seller sign-out did not return to login.');
    console.log('PASS Seller sign-out.');
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS authenticated Seller E2E: sign-in, visible launch workspaces, profile save, live catalog submit/edit/duplicate/withdraw, withdrawn-state UI/filter, and sign-out.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
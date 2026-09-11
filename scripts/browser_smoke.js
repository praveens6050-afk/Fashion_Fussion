const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const CART_KEY = 'fashion_fussion_cart';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', err => failures.push(`pageerror: ${err.message}`));

  async function visit(path, checks = [], targetPage = page) {
    const response = await targetPage.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response || !response.ok()) throw new Error(`${path} returned ${response && response.status()}`);
    for (const [selector, label] of checks) {
      if (!(await targetPage.locator(selector).count())) throw new Error(`${path}: missing ${label} (${selector})`);
    }
  }

  await visit('/index.html', [
    ['.brand', 'store brand'],
    ['#searchBox', 'desktop search'],
    ['#searchBtn', 'search action'],
    ['#products', 'product section']
  ]);

  await page.locator('#searchBox').fill('smoke-query');
  await Promise.all([
    page.waitForURL(url => url.pathname.endsWith('/search.html') && url.searchParams.get('q') === 'smoke-query'),
    page.locator('#searchBtn').click()
  ]);

  await visit('/search.html?q=test', [
    ['.brand', 'store brand'],
    ['#searchBox', 'search input'],
    ['#categoryList', 'department filters'],
    ['#sort', 'sort control'],
    ['#grid', 'results grid']
  ]);

  await visit('/cart.html', [
    ['.logo', 'store brand'],
    ['#cart', 'cart region'],
    ['#prices', 'price summary'],
    ['#place', 'checkout button']
  ]);

  // Checkout can redirect signed-out visitors before smoke assertions run.
  // Validate its desktop structure with JavaScript disabled, then keep normal
  // JavaScript-enabled checks for the other public pages.
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  const staticPage = await staticContext.newPage();
  await visit('/checkout.html', [
    ['.logo', 'store brand'],
    ['#addressBox', 'delivery address section'],
    ['#itemsBox', 'order summary section'],
    ['#continueBtn', 'place order button']
  ], staticPage);
  await staticContext.close();

  await visit('/product.html', [
    ['.logo', 'store brand'],
    ['#loading', 'product loading/error region'],
    ['#retailMode', 'retail mode'],
    ['#bulkMode', 'bulk mode']
  ]);

  // Stateful discovery → product → cart → checkout/login journey.
  // Product data is mocked so this check is deterministic and does not depend
  // on external catalogue availability during CI.
  const journeyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const journeyPage = await journeyContext.newPage();
  const smokeProduct = {
    id: 900001,
    name: 'Smoke Test Product',
    description: 'Deterministic desktop journey product',
    category: 'Smoke Department',
    price: 250,
    rating: 4.5,
    reviews: 2,
    gst_rate: 18,
    image_url: null,
    badge: null,
    is_active: true
  };

  await journeyPage.route('**/rest/v1/products*', async route => {
    const request = route.request();
    const accept = String(request.headers()['accept'] || '');
    const body = accept.includes('application/vnd.pgrst.object+json')
      ? JSON.stringify(smokeProduct)
      : JSON.stringify([smokeProduct]);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-range': '0-0/1'
      },
      body
    });
  });

  await visit('/search.html?q=Smoke', [
    ['#grid', 'journey search results']
  ], journeyPage);
  await journeyPage.locator('#grid .product').waitFor({ state: 'visible', timeout: 10000 });
  if (!(await journeyPage.locator('#grid').textContent()).includes('Smoke Test Product')) {
    throw new Error('journey search did not render mocked product');
  }

  await Promise.all([
    journeyPage.waitForURL(url => url.pathname.endsWith('/product.html') && url.searchParams.get('id') === '900001'),
    journeyPage.locator('#grid .details').click()
  ]);
  await journeyPage.locator('#product').waitFor({ state: 'visible', timeout: 10000 });
  if ((await journeyPage.locator('#name').textContent()) !== 'Smoke Test Product') {
    throw new Error('journey PDP did not preserve selected product');
  }

  await journeyPage.locator('#add').click();
  const cartAfterAdd = await journeyPage.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), CART_KEY);
  if (Number(cartAfterAdd['900001']) !== 1) throw new Error('journey PDP add-to-cart did not persist quantity');

  await journeyPage.goto(BASE + '/cart.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await journeyPage.locator('.item').waitFor({ state: 'visible', timeout: 10000 });
  if ((await journeyPage.locator('[data-qty="900001"]').inputValue()) !== '1') {
    throw new Error('journey cart did not restore persisted quantity');
  }
  const priceText = await journeyPage.locator('#prices').textContent();
  for (const expected of ['₹250', '₹45', '₹49']) {
    if (!priceText.includes(expected)) throw new Error(`journey cart missing expected price component ${expected}`);
  }

  await Promise.all([
    journeyPage.waitForURL(url => url.pathname.endsWith('/login.html') && url.searchParams.get('redirect') === 'checkout'),
    journeyPage.locator('#place').click()
  ]);
  const cartAfterLoginRedirect = await journeyPage.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), CART_KEY);
  if (Number(cartAfterLoginRedirect['900001']) !== 1) {
    throw new Error('journey cart state was lost while redirecting signed-out checkout to login');
  }
  await journeyContext.close();

  if (failures.length) throw new Error(failures.join('\n'));
  await browser.close();
  console.log('Desktop Chromium smoke checks passed. Stateful commerce journey passed.');
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});

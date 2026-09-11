const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';

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
    ['.search input', 'desktop search'],
    ['#products', 'product section']
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

  if (failures.length) throw new Error(failures.join('\n'));
  await browser.close();
  console.log('Desktop Chromium smoke checks passed.');
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});

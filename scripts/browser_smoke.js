const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failures = [];
  page.on('pageerror', err => failures.push(`pageerror: ${err.message}`));

  async function visit(path, checks = []) {
    const response = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response || !response.ok()) throw new Error(`${path} returned ${response && response.status()}`);
    for (const [selector, label] of checks) {
      if (!(await page.locator(selector).count())) throw new Error(`${path}: missing ${label} (${selector})`);
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

  await visit('/checkout.html', [
    ['.logo', 'store brand'],
    ['#addressBox', 'delivery address section'],
    ['#itemsBox', 'order summary section'],
    ['#continueBtn', 'place order button']
  ]);

  await visit('/product.html', [
    ['.logo', 'store brand'],
    ['#loading', 'product loading/error region'],
    ['#retailMode', 'retail mode'],
    ['#bulkMode', 'bulk mode']
  ]);

  if (failures.length) throw new Error(failures.join('\n'));
  await browser.close();
  console.log('Desktop Chromium smoke checks passed.');
})().catch(async err => {
  console.error(err.stack || err);
  process.exit(1);
});

const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const CART_KEY = 'fashion_fussion_cart';
const CHECKOUT_KEY = 'fashion_fussion_checkout_key';

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

  // Auth-only pages can redirect signed-out visitors before smoke assertions run.
  // Validate their desktop structure with JavaScript disabled, then keep normal
  // JavaScript-enabled checks for public/stateful commerce pages.
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  const staticPage = await staticContext.newPage();
  await visit('/checkout.html', [
    ['.logo', 'store brand'],
    ['#addressSection', 'saved-address checkout step'],
    ['#addressState', 'address selection state'],
    ['#addressBox', 'delivery address region'],
    ['#itemsBox', 'order summary section'],
    ['#continueBtn', 'place order button']
  ], staticPage);
  await visit('/quote-checkout.html?quote=1', [
    ['.logo', 'business checkout store brand'],
    ['#businessBox', 'business snapshot region'],
    ['#addressBox', 'business delivery address region'],
    ['#itemsBox', 'quoted item summary'],
    ['#priceBox', 'authoritative quote price summary'],
    ['#poNo', 'purchase order field'],
    ['input[name="payment"][value="prepaid"]', 'business prepaid payment option'],
    ['input[name="payment"][value="cod"]', 'business COD payment option'],
    ['#payBtn', 'business quote checkout action']
  ], staticPage);
  if (await staticPage.locator('#couponCode,#giftCode,#applyCoupon,#applyGift').count()) {
    throw new Error('quote-checkout.html: negotiated quote checkout must not expose coupon/gift-card controls');
  }
  await visit('/order-confirmation.html?id=1', [
    ['.logo', 'confirmation store brand'],
    ['#orderRef', 'order reference'],
    ['#items', 'confirmed items region'],
    ['#payment', 'payment summary'],
    ['#detailsLink', 'order details action']
  ], staticPage);
  await visit('/order-details.html?id=1', [
    ['.logo', 'order details store brand'],
    ['#root', 'order details root'],
    ['#cancelModal', 'cancellation modal'],
    ['#cancelReason', 'cancellation reason selector']
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

  // A cart mutation must invalidate any stale checkout quote/idempotency key and
  // immediately recalculate the local desktop summary.
  await journeyPage.evaluate(key => sessionStorage.setItem(key, 'smoke-stale-checkout-key'), CHECKOUT_KEY);
  const qtyInput = journeyPage.locator('[data-qty="900001"]');
  await qtyInput.fill('2');
  await qtyInput.dispatchEvent('change');
  await journeyPage.waitForFunction(() => document.querySelector('#prices')?.textContent?.includes('₹590'));

  const cartAfterQuantityChange = await journeyPage.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), CART_KEY);
  if (Number(cartAfterQuantityChange['900001']) !== 2) {
    throw new Error('journey cart quantity change did not persist quantity 2');
  }
  const checkoutKeyAfterMutation = await journeyPage.evaluate(key => sessionStorage.getItem(key), CHECKOUT_KEY);
  if (checkoutKeyAfterMutation !== null) {
    throw new Error('journey cart mutation did not invalidate stale checkout key');
  }
  const updatedPriceText = await journeyPage.locator('#prices').textContent();
  for (const expected of ['₹500', '₹90', 'FREE', '₹590']) {
    if (!updatedPriceText.includes(expected)) throw new Error(`journey cart recalculation missing ${expected}`);
  }

  await Promise.all([
    journeyPage.waitForURL(url => url.pathname.endsWith('/login.html') && url.searchParams.get('redirect') === 'checkout'),
    journeyPage.locator('#place').click()
  ]);
  const cartAfterLoginRedirect = await journeyPage.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), CART_KEY);
  if (Number(cartAfterLoginRedirect['900001']) !== 2) {
    throw new Error('journey cart state was lost while redirecting signed-out checkout to login');
  }
  await journeyContext.close();

  // Deterministic authenticated checkout runtime coverage. This replaces only
  // remote auth/data/payment dependencies while exercising the real checkout
  // page JavaScript, address selection, authoritative quote rendering and COD
  // order completion/redirect behavior.
  const checkoutContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const checkoutPage = await checkoutContext.newPage();
  const checkoutProduct = {
    id: 900002,
    name: 'Authenticated Checkout Product',
    category: 'Smoke Department',
    price: 250,
    image_url: null,
    is_active: true
  };
  const checkoutAddress = {
    id: 77,
    label: 'Home',
    full_name: 'Smoke Customer',
    phone: '9999999999',
    address_line1: '1 Test Street',
    address_line2: null,
    city: 'Jaipur',
    state: 'Rajasthan',
    postal_code: '302001',
    country: 'India',
    is_default: true,
    created_at: '2026-01-01T00:00:00.000Z'
  };

  await checkoutContext.addInitScript(({ cartKey }) => {
    localStorage.setItem(cartKey, JSON.stringify({ '900002': 1 }));
  }, { cartKey: CART_KEY });

  await checkoutPage.route('**/supabase-config.js*', async route => {
    const stub = `
      (() => {
        const session={access_token:'smoke-access-token',user:{id:'smoke-user',email:'smoke@example.test'}};
        const product=${JSON.stringify(checkoutProduct)};
        const address=${JSON.stringify(checkoutAddress)};
        function query(table){
          const q={
            select(){return q},in(){return q},eq(){return q},order(){return q},
            async maybeSingle(){
              if(table==='profiles')return {data:{full_name:'Smoke Customer',phone:'9999999999'},error:null};
              return {data:null,error:null};
            },
            then(resolve,reject){
              const data=table==='products'?[product]:table==='customer_addresses'?[address]:[];
              return Promise.resolve({data,error:null}).then(resolve,reject);
            }
          };
          return q;
        }
        window.supabaseClient={auth:{async getSession(){return {data:{session},error:null}}},from:query};
      })();`;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });

  await checkoutPage.route('https://fashion-fussion-olive.vercel.app/api/**', async route => {
    const request = route.request();
    if (request.headers()['authorization'] !== 'Bearer smoke-access-token') {
      throw new Error('authenticated checkout API call did not include the current bearer session');
    }
    const url = new URL(request.url());
    const payload = JSON.parse(request.postData() || '{}');
    if (url.pathname.endsWith('/quote-order')) {
      if (payload.items?.[0]?.id !== 900002 || payload.items?.[0]?.qty !== 1) {
        throw new Error('authenticated checkout quote did not preserve cart items');
      }
      const paymentMethod = payload.payment_method || 'prepaid';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pricing: {
            subtotal: 250,
            gst: 45,
            delivery: 49,
            coupon_discount: 0,
            gift_card_discount: 0,
            total: 344,
            payment_method: paymentMethod
          }
        })
      });
      return;
    }
    if (url.pathname.endsWith('/create-order')) {
      if (payload.payment_method !== 'cod') throw new Error('authenticated smoke checkout must submit COD');
      if (Number(payload.shipping_address?.id) !== 77) throw new Error('authenticated checkout did not submit selected address');
      if (!payload.checkout_key || String(payload.checkout_key).length < 16) throw new Error('authenticated checkout did not submit an idempotency key');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          store_order_id: 880001,
          display_order_id: 'FF-SMOKE-880001',
          payment_method: 'cod',
          status: 'cod_pending',
          completed: true,
          total: 344
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected smoke API route' }) });
  });

  const checkoutResponse = await checkoutPage.goto(BASE + '/checkout.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!checkoutResponse || !checkoutResponse.ok()) throw new Error('authenticated checkout page failed to load');
  await checkoutPage.locator('.address-option.selected').waitFor({ state: 'visible', timeout: 10000 });
  if (!(await checkoutPage.locator('#addressBox').textContent()).includes('Smoke Customer')) {
    throw new Error('authenticated checkout did not render the saved delivery address');
  }
  await checkoutPage.waitForFunction(() => !document.querySelector('#continueBtn')?.disabled);
  const authenticatedPriceText = await checkoutPage.locator('#priceBox').textContent();
  for (const expected of ['₹250', '₹45', '₹49', '₹344']) {
    if (!authenticatedPriceText.includes(expected)) throw new Error(`authenticated checkout price summary missing ${expected}`);
  }
  const deliveryNote = await checkoutPage.locator('.delivery-note').textContent();
  if (!deliveryNote.includes('non-refundable')) throw new Error('authenticated checkout did not disclose non-refundable sub-₹299 delivery');

  await checkoutPage.locator('input[name="paymentMethod"][value="cod"]').check();
  await checkoutPage.waitForFunction(() => !document.querySelector('#continueBtn')?.disabled && document.querySelector('#continueBtn')?.textContent?.includes('COD'));
  await Promise.all([
    checkoutPage.waitForURL(url => url.pathname.endsWith('/order-confirmation.html') && url.searchParams.get('id') === '880001'),
    checkoutPage.locator('#continueBtn').click()
  ]);
  const completedState = await checkoutPage.evaluate(({ cartKey, checkoutKey }) => ({
    cart: localStorage.getItem(cartKey),
    checkout: sessionStorage.getItem(checkoutKey)
  }), { cartKey: CART_KEY, checkoutKey: CHECKOUT_KEY });
  if (completedState.cart !== null || completedState.checkout !== null) {
    throw new Error('completed authenticated checkout did not clear cart/idempotency state');
  }
  await checkoutContext.close();

  if (failures.length) throw new Error(failures.join('\n'));
  await browser.close();
  console.log('Desktop Chromium smoke checks passed. Retail journey, authenticated COD checkout and business quote checkout structure are covered.');
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
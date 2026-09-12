const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));

  let cancelled = false;
  let cancelPayload = null;
  const activeOrder = {
    id: 880002,
    display_order_id: 'FF-SMOKE-880002',
    user_id: 'smoke-user',
    total_amount: 294,
    currency: 'INR',
    status: 'paid',
    payment_method: 'prepaid',
    payment_verified_at: '2026-09-12T10:00:00.000Z',
    payment_source: 'razorpay',
    fulfillment_status: 'ordered',
    fulfillment_updated_at: '2026-09-12T10:00:00.000Z',
    customer_name: 'Smoke Customer',
    customer_email: 'smoke@example.test',
    customer_phone: '9999999999',
    items: [{ id: 900003, name: 'Promotion Restore Product', category: 'Smoke Department', qty: 1, unit_price: 250, taxable_amount: 250, gst_amount: 45, gst_rate: 18, line_total: 295 }],
    shipping_address: { full_name: 'Smoke Customer', phone: '9999999999', address_line1: '1 Test Street', address_line2: null, city: 'Jaipur', state: 'Rajasthan', postal_code: '302001', country: 'India' },
    created_at: '2026-09-12T10:00:00.000Z',
    coupon_code: null,
    coupon_discount: 0,
    gift_card_code: 'SMOKE-GIFT',
    gift_card_discount: 50
  };

  await page.route('**/supabase-config.js*', async route => {
    const stub = `
      (() => {
        const session={access_token:'smoke-access-token',user:{id:'smoke-user',email:'smoke@example.test'}};
        const order=${JSON.stringify(activeOrder)};
        function currentOrder(){
          return window.__smokeCancelled?{...order,status:'refund_initiated',fulfillment_status:'cancelled',cancellation_reason:'Ordered by mistake',cancelled_at:'2026-09-12T11:00:00.000Z',refund_id:'internal-smoke-refund',refund_status:'pending',refund_reference:'RF-SMOKE-001',refund_amount:245,refund_updated_at:'2026-09-12T11:00:00.000Z'}:order;
        }
        function query(table){
          const q={select(){return q},eq(){return q},async maybeSingle(){return table==='orders'?{data:currentOrder(),error:null}:{data:null,error:null}}};
          return q;
        }
        window.supabaseClient={auth:{async getSession(){return {data:{session},error:null}}},from:query};
        document.addEventListener('DOMContentLoaded',()=>{
          for(const src of ['order-refund-tracker.js?v=1','order-cancel-promotion.js?v=1']){
            const s=document.createElement('script');s.src=src;s.async=false;document.head.appendChild(s);
          }
        },{once:true});
      })();`;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });

  await page.route('https://fashion-fussion-olive.vercel.app/api/**', async route => {
    const request = route.request();
    if (request.headers()['authorization'] !== 'Bearer smoke-access-token') throw new Error('order cancellation API call did not include the current bearer session');
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/cancel-order')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected order-details smoke API route' }) });
      return;
    }
    cancelPayload = JSON.parse(request.postData() || '{}');
    if (Number(cancelPayload.order_id) !== 880002) throw new Error('order cancellation submitted the wrong order ID');
    if (cancelPayload.reason !== 'Ordered by mistake') throw new Error('order cancellation did not submit the selected reason');
    cancelled = true;
    await page.evaluate(() => { window.__smokeCancelled = true; }).catch(() => null);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok:true,order_id:880002,display_order_id:'FF-SMOKE-880002',status:'refund_initiated',fulfillment_status:'cancelled',reason:'Ordered by mistake',promotions_restored:true,refund:{required:true,status:'pending',amount:245,delivery_non_refundable:49,destination:'original_payment_method'} }) });
  });

  const response = await page.goto(BASE + '/order-details.html?id=880002#cancel', { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error('authenticated order details page failed to load');
  await page.locator('#cancelOrderBtn').waitFor({ state: 'visible', timeout: 10000 });
  if (!(await page.locator('#actionsSection').textContent()).includes('same gift card')) throw new Error('gift-card cancellation UI did not explain balance restoration');

  await page.locator('#cancelOrderBtn').click();
  await page.locator('#cancelModal.show').waitFor({ state: 'visible', timeout: 5000 });
  const previewText = await page.locator('#refundPreview').textContent();
  for (const expected of ['Gift card balance restoration', '₹50', 'original payment method', 'same gift card', '₹49']) if (!previewText.includes(expected)) throw new Error(`gift-card cancellation preview missing ${expected}`);

  await page.locator('#cancelReason').selectOption({ label: 'Ordered by mistake' });
  await page.locator('#confirmCancel').click();
  await page.waitForTimeout(500);
  if (!cancelled || !cancelPayload) throw new Error('gift-card order cancellation did not reach the backend endpoint');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#persistedRefundTracker').waitFor({ state: 'visible', timeout: 10000 });
  const trackerText = await page.locator('#persistedRefundTracker').textContent();
  for (const expected of ['Refund tracker','Refund processing','₹245','Original payment method','RF-SMOKE-001','Ordered by mistake']) if (!trackerText.includes(expected)) throw new Error(`persisted refund tracker missing ${expected}`);
  if (trackerText.includes('internal-smoke-refund')) throw new Error('persisted refund tracker exposed an internal processor refund ID');

  if (failures.length) throw new Error(failures.join('\n'));
  await context.close();
  await browser.close();
  console.log('Authenticated order-details cancellation and persisted refund tracker smoke passed.');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
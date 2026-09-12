const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));

  const deliveredOrder = {
    id: 880003,
    display_order_id: 'FF-SMOKE-880003',
    user_id: 'smoke-user',
    total_amount: 590,
    currency: 'INR',
    status: 'paid',
    payment_method: 'prepaid',
    payment_verified_at: '2026-09-10T10:00:00.000Z',
    payment_source: 'razorpay',
    fulfillment_status: 'delivered',
    fulfillment_updated_at: '2026-09-12T10:00:00.000Z',
    customer_name: 'Smoke Customer',
    customer_email: 'smoke@example.test',
    customer_phone: '9999999999',
    items: [{
      id: 900004,
      name: 'Delivered Fashion Product',
      category: 'Fashion',
      qty: 2,
      unit_price: 250,
      taxable_amount: 500,
      gst_amount: 90,
      gst_rate: 18,
      line_total: 590,
      size: 'M',
      color: 'Black'
    }],
    shipping_address: {
      full_name: 'Smoke Customer', phone: '9999999999', address_line1: '1 Test Street', address_line2: null,
      city: 'Jaipur', state: 'Rajasthan', postal_code: '302001', country: 'India'
    },
    created_at: '2026-09-10T10:00:00.000Z',
    coupon_code: null,
    coupon_discount: 0,
    gift_card_code: null,
    gift_card_discount: 0
  };

  await page.route('**/supabase-config.js*', async route => {
    const stub = `
      (() => {
        const session={access_token:'smoke-access-token',user:{id:'smoke-user',email:'smoke@example.test'}};
        const order=${JSON.stringify(deliveredOrder)};
        let returnRequests=[];
        function query(table){
          const q={
            select(){return q},eq(){return q},order(){return q},
            async maybeSingle(){return table==='orders'?{data:order,error:null}:{data:null,error:null}},
            then(resolve,reject){const data=table==='return_requests'?returnRequests:[];return Promise.resolve({data,error:null}).then(resolve,reject)}
          };
          return q;
        }
        window.supabaseClient={
          auth:{async getSession(){return {data:{session},error:null}}},
          from:query,
          async rpc(name,args){
            if(name!=='create_return_request')return {data:null,error:{message:'Unexpected RPC '+name}};
            if(Number(args.p_order_id)!==880003)return {data:null,error:{message:'Wrong order ID'}};
            const row={
              id:returnRequests.length+1,order_id:880003,user_id:'smoke-user',item_index:Number(args.p_item_index),
              request_type:args.p_request_type,quantity:Number(args.p_quantity),reason:args.p_reason,
              requested_size:args.p_requested_size,status:'requested',created_at:'2026-09-12T12:00:00.000Z',updated_at:'2026-09-12T12:00:00.000Z'
            };
            returnRequests=[row,...returnRequests];
            window.__lastReturnRequest=args;
            return {data:row,error:null};
          }
        };
        document.addEventListener('DOMContentLoaded',()=>{
          const s=document.createElement('script');s.src='order-return-exchange.js?v=1';s.async=false;document.head.appendChild(s);
        },{once:true});
      })();`;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });

  const response = await page.goto(BASE + '/order-details.html?id=880003', { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error('authenticated delivered order details page failed to load');

  await page.locator('#returnExchangeBox').waitFor({ state: 'visible', timeout: 10000 });
  const boxText = await page.locator('#returnExchangeBox').textContent();
  for (const expected of ['Returns & exchanges','Exchange Size','Return for Refund','Report an Issue']) {
    if (!boxText.includes(expected)) throw new Error(`delivered order return/exchange UI missing ${expected}`);
  }

  await page.locator('[data-rex="exchange_size"]').click();
  await page.locator('#returnExchangeModal.show').waitFor({ state: 'visible', timeout: 5000 });
  if (!(await page.locator('#rexSizeField').isVisible())) throw new Error('exchange-size flow did not reveal requested-size field');
  if (!(await page.locator('.rex-note').textContent()).includes('not a stock promise')) throw new Error('exchange flow did not disclose that requested size is not guaranteed');
  await page.locator('#rexQty').fill('2');
  await page.locator('#rexSize').fill('L');
  await page.locator('#rexReason').fill('Need a larger size');
  await page.locator('#rexSubmit').click();
  await page.waitForFunction(() => window.__lastReturnRequest?.p_request_type === 'exchange_size');
  const exchangeRequest = await page.evaluate(() => window.__lastReturnRequest);
  if (Number(exchangeRequest.p_order_id) !== 880003 || Number(exchangeRequest.p_item_index) !== 0 || Number(exchangeRequest.p_quantity) !== 2 || exchangeRequest.p_requested_size !== 'L') {
    throw new Error('exchange-size request did not preserve order item, quantity, and requested size');
  }
  let historyText = await page.locator('#returnExchangeHistory').textContent();
  for (const expected of ['Request history','Exchange Size','Requested','Qty 2','Requested size: L','Need a larger size']) {
    if (!historyText.includes(expected)) throw new Error(`exchange request history missing ${expected}`);
  }

  await page.locator('[data-rex="return_refund"]').click();
  await page.locator('#returnExchangeModal.show').waitFor({ state: 'visible', timeout: 5000 });
  if (await page.locator('#rexSizeField').isVisible()) throw new Error('return-refund flow must not ask for a requested size');
  await page.locator('#rexQty').fill('1');
  await page.locator('#rexReason').fill('Item no longer needed');
  await page.locator('#rexSubmit').click();
  await page.waitForFunction(() => window.__lastReturnRequest?.p_request_type === 'return_refund');
  const refundRequest = await page.evaluate(() => window.__lastReturnRequest);
  if (refundRequest.p_requested_size !== null || Number(refundRequest.p_quantity) !== 1) throw new Error('return-refund request submitted incorrect size or quantity');

  await page.locator('[data-rex="report_issue"]').click();
  await page.locator('#returnExchangeModal.show').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#rexReason').fill('Received item has a stitching issue');
  await page.locator('#rexSubmit').click();
  await page.waitForFunction(() => window.__lastReturnRequest?.p_request_type === 'report_issue');

  historyText = await page.locator('#returnExchangeHistory').textContent();
  for (const expected of ['Return for Refund','Item no longer needed','Report an Issue','stitching issue']) {
    if (!historyText.includes(expected)) throw new Error(`return/exchange request history missing ${expected}`);
  }

  if (failures.length) throw new Error(failures.join('\n'));
  await context.close();
  await browser.close();
  console.log('Authenticated delivered-order return, exchange-size, and report-issue smoke passed.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
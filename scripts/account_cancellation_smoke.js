const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));

  const order = {
    id: 880004,
    display_order_id: 'FF-SMOKE-880004',
    user_id: 'smoke-user',
    status: 'paid',
    payment_method: 'prepaid',
    fulfillment_status: 'ordered',
    gift_card_discount: 50,
    total_amount: 294,
    created_at: '2026-09-12T10:00:00.000Z',
    items: [{ id: 900005, name: 'Gift Card Fashion Product', qty: 1, category: 'Fashion', gst_rate: 18 }]
  };

  await page.route('**/supabase-config.js*', async route => {
    const stub = `
      (() => {
        const session={access_token:'smoke-access-token',user:{id:'smoke-user',email:'smoke@example.test'}};
        const order=${JSON.stringify(order)};
        function query(table){
          const q={
            select(){return q},eq(){return q},order(){return q},limit(){return q},insert(){return q},update(){return q},delete(){return q},
            async maybeSingle(){return table==='profiles'?{data:{full_name:'Smoke Customer',phone:'9999999999'},error:null}:{data:null,error:null}},
            then(resolve,reject){const data=table==='orders'?[order]:table==='customer_addresses'?[]:[];return Promise.resolve({data,error:null}).then(resolve,reject)}
          };
          return q;
        }
        window.supabaseClient={auth:{async getSession(){return {data:{session},error:null}},async signOut(){return {error:null}}},from:query};
        document.addEventListener('DOMContentLoaded',()=>{
          const s=document.createElement('script');s.src='account-cancel-promotion.js?v=1';s.async=false;document.head.appendChild(s);
        },{once:true});
      })();`;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });

  const response = await page.goto(BASE + '/account.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error('account page failed to load');
  await page.locator('#ordersList .order').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#ordersList .order-actions a[href*="#cancel"]').waitFor({ state: 'visible', timeout: 10000 });

  const cancel = page.locator('#ordersList .order-actions a[href*="#cancel"]');
  const href = await cancel.getAttribute('href');
  if (!href || !href.includes('order-details.html?id=880004#cancel')) throw new Error(`account cancellation CTA points to unexpected destination: ${href}`);

  const eligible = await page.evaluate(() => window.canCancel?.({
    status:'paid',payment_method:'prepaid',fulfillment_status:'ordered',gift_card_discount:50
  }));
  if (eligible !== true) throw new Error('promotion-aware account cancellation did not allow eligible gift-card order');

  const shipped = await page.evaluate(() => window.canCancel?.({
    status:'paid',payment_method:'prepaid',fulfillment_status:'shipped',gift_card_discount:50
  }));
  if (shipped !== false) throw new Error('promotion-aware account cancellation incorrectly allowed shipped gift-card order');

  if (failures.length) throw new Error(failures.join('\n'));
  await browser.close();
  console.log('Account gift-card cancellation eligibility smoke passed.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
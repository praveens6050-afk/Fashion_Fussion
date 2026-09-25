const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {paymentPricing,normalizePaymentMethod,roundMoney,normalizeCartRequest,cors}=require('./lib');

assert.deepStrictEqual(paymentPricing(100,'prepaid'),{payment_method:'prepaid',payment_handling_fee:0,prepaid_discount:0,cod_fee:0,cod_fee_non_refundable:false,total:100});
assert.deepStrictEqual(paymentPricing(100,'cod'),{payment_method:'cod',payment_handling_fee:0,prepaid_discount:0,cod_fee:0,cod_fee_non_refundable:false,total:100});
assert.strictEqual(paymentPricing(0,'prepaid').total,0);
assert.strictEqual(normalizePaymentMethod(undefined),'prepaid');
assert.throws(()=>normalizePaymentMethod('upi'),/Invalid payment method/);
assert.strictEqual(roundMoney(10.005),10.01);
assert.deepStrictEqual(normalizeCartRequest([{id:9,variant_id:15,qty:2}]),[{id:'9',variant_id:'15',qty:2}]);
assert.throws(()=>normalizeCartRequest([{id:9,variant_id:15,qty:1},{id:9,variant_id:15,qty:1}]),/Duplicate cart line/);
assert.throws(()=>normalizeCartRequest([{id:9,variant_id:'bad',qty:1}]),/Invalid variant ID/);

function fakeRes(){return{headers:{},setHeader(name,value){this.headers[name]=value}}}
const goodRes=fakeRes();
assert.strictEqual(cors({headers:{origin:'https://praveens6050-afk.github.io'}},goodRes),true);
assert.strictEqual(goodRes.headers['Access-Control-Allow-Origin'],'https://praveens6050-afk.github.io');
const badRes=fakeRes();
assert.strictEqual(cors({headers:{origin:'https://evil.example'}},badRes),false);

const read=name=>fs.readFileSync(path.join(__dirname,'api',name),'utf8');
const clientSource=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const lib=fs.readFileSync(path.join(__dirname,'lib.js'),'utf8');
for(const required of ['has_variants','getVariantsByIds','getInventoryByVariantIds','variant_id','product_variants','inventory_levels'])assert.ok(lib.includes(required),`Variant pricing must enforce ${required}`);

const createOrder=read('create-order.js');
for(const required of ['reserve_order_inventory','release_order_inventory','finalize_cod_order_inventory','finalize_zero_value_order_inventory'])assert.ok(createOrder.includes(required),`Checkout inventory lifecycle must enforce ${required}`);

const verifyPayment=read('verify-payment.js');
for(const required of ['commit_order_inventory','Inventory finalization is being reconciled'])assert.ok(verifyPayment.includes(required),`Verified payment lifecycle must enforce ${required}`);

const webhook=read('razorpay-webhook.js');
for(const eventName of ['refund.created','refund.processed','refund.failed'])assert.ok(webhook.includes(eventName),`Webhook must handle ${eventName}`);
for(const required of ['loadReturnRequestByRefund','updateReturnRefundStatus','commit_order_inventory'])assert.ok(webhook.includes(required),`Webhook reconciliation must enforce ${required}`);

const cancelOrder=read('cancel-order.js');
for(const required of ['release_order_inventory','restock_cancelled_order_inventory','restore_cancelled_order_promotions'])assert.ok(cancelOrder.includes(required),`Cancellation must reconcile ${required}`);

const refundStatus=read('refund-status.js');
for(const field of ['refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])assert.ok(refundStatus.includes(field),`Refund reconciliation must persist ${field}`);

const returnRefundStatus=read('return-refund-status.js');
for(const required of ['getSupabaseUser','user_id=eq.','return_refund','refund_id','refund_amount','pending','processed','failed'])assert.ok(returnRefundStatus.includes(required),`Return refund status must enforce ${required}`);

const quoteOrder=read('create-quote-order.js');
for(const field of ['bulk_quote_id','quoted_subtotal','quoted_gst','quoted_delivery','quoted_total','accepted_at'])assert.ok(quoteOrder.includes(field),`Accepted quote order must enforce ${field}`);

const shippingStatus=read('customer-shipping-status.js');
for(const required of ['getSupabaseUser','user_id','order_shipments','direction=eq.forward'])assert.ok(shippingStatus.includes(required),`Customer shipment status must enforce ${required}`);
assert.ok(!shippingStatus.includes('requireAdminUser'),'Customer shipment status must not depend on admin authorization');

function storage(initial={}){
  const values=new Map(Object.entries(initial));
  return{
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)},
    dump(){return Object.fromEntries(values)}
  };
}
const reconcileSource=clientSource('checkout-cart-reconcile.js');
const reconcileLocal=storage({fashion_fussion_cart:JSON.stringify({42:1})});
const reconcileSession=storage({fashion_fussion_checkout_key:'stale-checkout'});
vm.runInNewContext(reconcileSource,{
  window:{FashionVariantCart:{readLines:()=>[{id:42,variant_id:null,qty:5}]}},
  localStorage:reconcileLocal,
  sessionStorage:reconcileSession
});
assert.deepStrictEqual(JSON.parse(reconcileLocal.getItem('fashion_fussion_cart')),{'42':5},'Checkout must reconcile legacy quantity to authoritative cart-line quantity');
assert.strictEqual(reconcileSession.getItem('fashion_fussion_checkout_key'),null,'Quantity reconciliation must invalidate stale checkout idempotency key');

const multiLineLocal=storage({fashion_fussion_cart:JSON.stringify({42:1})});
const multiLineSession=storage({fashion_fussion_checkout_key:'stale-checkout'});
vm.runInNewContext(reconcileSource,{
  window:{FashionVariantCart:{readLines:()=>[{id:42,variant_id:7,qty:2},{id:42,variant_id:8,qty:3}]}},
  localStorage:multiLineLocal,
  sessionStorage:multiLineSession
});
assert.deepStrictEqual(JSON.parse(multiLineLocal.getItem('fashion_fussion_cart')),{'42':5},'Checkout must aggregate multiple variant lines for legacy product quantity');

const loginSource=clientSource('csp-login.js');
const signupSource=clientSource('csp-signup.js');
for(const route of ['wishlist.html','notifications.html','coupons.html','gift-cards.html','order-details.html','order-confirmation.html','quote-checkout.html']){
  assert.ok(loginSource.includes(`'${route}'`),`Login must preserve protected return target ${route}`);
  assert.ok(signupSource.includes(`'${route}'`),`Signup must preserve protected return target ${route}`);
}

const desktopAccountLoader=clientSource('desktop-account-loader.js');
assert.ok(desktopAccountLoader.includes("leaf.includes('.')?leaf:leaf+'.html'"),'Desktop account loader must normalize extensionless production routes');
const accountStability=clientSource('account-stability.js');
assert.ok(accountStability.includes("leaf.includes('.')?leaf:leaf+'.html'"),'Account stability fallback must normalize extensionless production route');

const accountSource=clientSource('csp-account.js');
for(const required of ['accountLoginHref','account.html','location.search','location.hash','auth.getSession()'])assert.ok(accountSource.includes(required),`Account auth recovery must preserve ${required}`);

const businessOrderSource=clientSource('order-business-details.js');
assert.ok(businessOrderSource.includes("leaf.includes('.')?leaf:leaf+'.html'"),'Business order details must normalize extensionless production routes');
assert.ok(businessOrderSource.includes('auth.getSession()'),'Business order details must recover from transient verified-user errors when a browser session exists');

const confirmationSource=clientSource('csp-order-confirmation.js');
for(const required of ['resolvedUser','auth.getSession()','order-confirmation.html','location.search','location.hash'])assert.ok(confirmationSource.includes(required),`Order confirmation auth recovery must preserve ${required}`);

const returnExchangeSource=clientSource('order-return-exchange.js');
for(const required of ['rrError','historyError','Request history unavailable','could not be loaded'])assert.ok(returnExchangeSource.includes(required),`Order return history failures must surface ${required}`);

const orderShippingSource=clientSource('order-shipping.js');
for(const required of ['failureCount','retryPending','failureCount>=3','setTimeout'])assert.ok(orderShippingSource.includes(required),`Customer shipping status must bounded-retry transient failures via ${required}`);

const notificationSource=clientSource('csp-notifications.js');
for(const required of ['resolvedUser','auth.getSession()','notifications.html','location.search','location.hash'])assert.ok(notificationSource.includes(required),`Notifications auth recovery must preserve ${required}`);

const wishlistSource=clientSource('csp-wishlist.js');
for(const required of ['resolvedUser','auth.getSession()','wishlist.html','location.search','location.hash'])assert.ok(wishlistSource.includes(required),`Wishlist auth recovery must preserve ${required}`);

const promotionSource=clientSource('promotions.js');
for(const required of ['auth.getSession()','coupons.html','gift-cards.html','id,code,title,description,discount_type,discount_value','id,title,amount,description,validity_days'])assert.ok(promotionSource.includes(required),`Promotion catalog auth/query hardening must preserve ${required}`);
assert.ok(!promotionSource.includes("select('*')"),'Promotion catalog must not use unrestricted select(*)');
const couponsHtml=clientSource('coupons.html'),giftCardsHtml=clientSource('gift-cards.html'),notificationsHtml=clientSource('notifications.html'),wishlistHtml=clientSource('wishlist.html');
assert.ok(couponsHtml.includes('promotions.js?v=2'),'Coupons must load hardened promotion runtime');
assert.ok(giftCardsHtml.includes('promotions.js?v=2'),'Gift Cards must load hardened promotion runtime');
assert.ok(notificationsHtml.includes('csp-notifications.js?v=2'),'Notifications must load hardened auth runtime');
assert.ok(wishlistHtml.includes('csp-wishlist.js?v=3'),'Wishlist must load hardened auth runtime');

console.log('Fashion_Fussion customer backend pricing/payment/refund/quote/shipping/cart/auth/post-purchase resilience audit tests passed');

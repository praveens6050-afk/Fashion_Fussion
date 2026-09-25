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

// Direct Checkout must use the authoritative variant-line quantities even if an
// older legacy cart object is stale. This regression reproduces the customer
// report where the line showed quantity 5 while the initial summary used qty 1.
function storage(initial={}){
  const values=new Map(Object.entries(initial));
  return{
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)},
    dump(){return Object.fromEntries(values)}
  };
}
const reconcileSource=fs.readFileSync(path.join(__dirname,'..','checkout-cart-reconcile.js'),'utf8');
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

// Authentication return targets must stay consistent between Login and Signup.
// Customers coming from protected order/quote pages must not lose their intended
// destination just because they create an account instead of signing in.
const signupSource=fs.readFileSync(path.join(__dirname,'..','csp-signup.js'),'utf8');
for(const route of ['order-details.html','order-confirmation.html','quote-checkout.html'])assert.ok(signupSource.includes(`'${route}'`),`Signup must preserve protected return target ${route}`);

// Extensionless Cloudflare routes are the production URLs. Premium account CSS
// and the stability fallback must therefore recognize /account and /order-details,
// not only their .html source filenames.
const desktopAccountLoader=fs.readFileSync(path.join(__dirname,'..','desktop-account-loader.js'),'utf8');
assert.ok(desktopAccountLoader.includes("leaf.includes('.')?leaf:leaf+'.html'"),'Desktop account loader must normalize extensionless production routes');
const accountStability=fs.readFileSync(path.join(__dirname,'..','account-stability.js'),'utf8');
assert.ok(accountStability.includes("leaf.includes('.')?leaf:leaf+'.html'"),'Account stability fallback must normalize extensionless production route');

// Account auth recovery should preserve the current account intent and tolerate a
// transient verified-user request failure when a browser session is still present.
const accountSource=fs.readFileSync(path.join(__dirname,'..','csp-account.js'),'utf8');
for(const required of ['accountLoginHref','account.html','location.search','location.hash','auth.getSession()'])assert.ok(accountSource.includes(required),`Account auth recovery must preserve ${required}`);

console.log('Fashion_Fussion customer backend pricing/payment/refund/quote/shipping/cart/auth audit tests passed');

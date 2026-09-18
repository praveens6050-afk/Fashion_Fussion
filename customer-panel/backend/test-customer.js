const assert=require('assert');
const fs=require('fs');
const path=require('path');
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

console.log('Fashion_Fussion customer backend pricing/payment/refund/quote/shipping audit tests passed');

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {paymentPricing,normalizePaymentMethod,roundMoney,normalizeCartRequest,cors}=require('./lib');

assert.deepStrictEqual(paymentPricing(100,'prepaid'),{payment_method:'prepaid',payment_handling_fee:0,prepaid_discount:0,cod_fee:0,cod_fee_non_refundable:false,total:100});
assert.deepStrictEqual(paymentPricing(100,'cod'),{payment_method:'cod',payment_handling_fee:0,prepaid_discount:0,cod_fee:0,cod_fee_non_refundable:false,total:100});
assert.strictEqual(paymentPricing(0,'prepaid').total,0);
assert.strictEqual(paymentPricing(0,'cod').total,0);
assert.strictEqual(normalizePaymentMethod(undefined),'prepaid');
assert.throws(()=>normalizePaymentMethod('upi'),/Invalid payment method/);
assert.strictEqual(roundMoney(10.005),10.01);
assert.deepStrictEqual(normalizeCartRequest([{id:9,qty:2}]),[{id:'9',qty:2}]);
assert.deepStrictEqual(normalizeCartRequest([{id:9,qty:500}]),[{id:'9',qty:500}]);
assert.throws(()=>normalizeCartRequest([{id:9,qty:20},{id:9,qty:1}]),/Duplicate product ID/);
assert.throws(()=>normalizeCartRequest(Array.from({length:51},(_,i)=>({id:i+1,qty:1}))),/Too many cart items/);
assert.throws(()=>normalizeCartRequest([{id:9,qty:501}]),/Invalid quantity/);

function fakeRes(){return{headers:{},setHeader(name,value){this.headers[name]=value}}}
const goodRes=fakeRes();
assert.strictEqual(cors({headers:{origin:'https://praveens6050-afk.github.io'}},goodRes),true);
assert.strictEqual(goodRes.headers['Access-Control-Allow-Origin'],'https://praveens6050-afk.github.io');
assert.strictEqual(goodRes.headers['Cache-Control'],'no-store');
assert.strictEqual(goodRes.headers['X-Content-Type-Options'],'nosniff');
const badRes=fakeRes();
assert.strictEqual(cors({headers:{origin:'https://evil.example'}},badRes),false);
assert.strictEqual(badRes.headers['Access-Control-Allow-Origin'],undefined);

const webhook=fs.readFileSync(path.join(__dirname,'api/razorpay-webhook.js'),'utf8');
assert.ok(webhook.includes("refund_reference: refundReference(refund) || order.refund_reference || null"),'Webhook must preserve an existing refund reference when a later event omits acquirer data');
assert.ok(webhook.includes("reason: 'different_refund_reference'"),'Webhook must reject a different refund ID once one is persisted');
for(const eventName of ['refund.created','refund.processed','refund.failed'])assert.ok(webhook.includes(eventName),`Webhook must handle ${eventName}`);
for(const required of ['loadReturnRequestByRefund','updateReturnRefundStatus','return_refund_updated','return_refund_mismatch'])assert.ok(webhook.includes(required),`Webhook must reconcile return refunds with ${required}`);
const cancelOrder=fs.readFileSync(path.join(__dirname,'api/cancel-order.js'),'utf8');
for(const field of ['cancellation_reason','cancelled_at','refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])assert.ok(cancelOrder.includes(field),`Cancellation must persist ${field}`);
const refundStatus=fs.readFileSync(path.join(__dirname,'api/refund-status.js'),'utf8');
for(const field of ['refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])assert.ok(refundStatus.includes(field),`Refund reconciliation must persist ${field}`);

const processReturnRefund=fs.readFileSync(path.join(__dirname,'api/process-return-refund.js'),'utf8');
for(const required of ['requireAdmin','return_refund','X-Refund-Idempotency','FF_RETURN_','COD_PAYOUT_REQUIRED','DISCOUNT_ALLOCATION_REQUIRED','refund_id=is.null','original_payment_method'])assert.ok(processReturnRefund.includes(required),`Return refund processing must enforce ${required}`);
assert.ok(processReturnRefund.includes("['approved','return_processing']"),'Return refund must require an approved processing state');
assert.ok(processReturnRefund.includes("payment_method || '').toLowerCase() !== 'prepaid'"),'Automated return refunds must be prepaid-only');
const returnRefundStatus=fs.readFileSync(path.join(__dirname,'api/return-refund-status.js'),'utf8');
for(const required of ['getSupabaseUser','user_id=eq.','return_refund','refund_id','refund_amount','pending','processed','failed','original_payment_method'])assert.ok(returnRefundStatus.includes(required),`Return refund reconciliation fallback must enforce ${required}`);
assert.ok(returnRefundStatus.includes("fetch('https://api.razorpay.com/v1/refunds/"),'Return refund reconciliation must query Razorpay by persisted refund ID');

const quoteOrder=fs.readFileSync(path.join(__dirname,'api/create-quote-order.js'),'utf8');
for(const field of ['bulk_quote_id','quoted_subtotal','quoted_gst','quoted_delivery','quoted_total','accepted_at','business_billing_address:quote.business_billing_address','findExistingQuoteOrder','createRazorpayOrder'])assert.ok(quoteOrder.includes(field),`Accepted quote order must enforce ${field}`);
assert.ok(quoteOrder.includes("quote.status!=='accepted'"),'Only accepted quotes may create quote orders');
assert.ok(quoteOrder.includes("new Date(quote.valid_until).getTime()<Date.now()"),'Quote checkout must reject expired quotes');
assert.ok(quoteOrder.includes('Math.abs(normalized.subtotal-quotedSubtotal)>0.01'),'Quote subtotal must be independently verified');
assert.ok(quoteOrder.includes('Math.abs(normalized.gst-quotedGst)>0.01'),'Quote GST must be independently verified');
assert.ok(quoteOrder.includes('roundMoney(normalized.subtotal+normalized.gst+quotedDelivery)-quotedTotal'),'Quote total must be independently verified');
assert.ok(!quoteOrder.includes('calculate(body.items'),'Quote order must not use retail cart repricing');
assert.ok(!quoteOrder.includes('coupon_code:body'),'Quote order must not accept browser coupon pricing');
assert.ok(!quoteOrder.includes('gift_card_code:body'),'Quote order must not accept browser gift-card pricing');
assert.ok(quoteOrder.includes('coupon_code:null'),'Negotiated quote orders must disable coupons');
assert.ok(quoteOrder.includes('gift_card_code:null'),'Negotiated quote orders must disable gift cards');

console.log('Fashion_Fussion backend pricing/security/refund/return-refund/quote audit tests passed');

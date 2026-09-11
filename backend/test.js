const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {paymentPricing,normalizePaymentMethod,roundMoney,normalizeCartRequest,cors}=require('./lib');

assert.deepStrictEqual(paymentPricing(100,'prepaid'),{
  payment_method:'prepaid',
  payment_handling_fee:0,
  prepaid_discount:0,
  cod_fee:0,
  cod_fee_non_refundable:false,
  total:100
});
assert.deepStrictEqual(paymentPricing(100,'cod'),{
  payment_method:'cod',
  payment_handling_fee:0,
  prepaid_discount:0,
  cod_fee:0,
  cod_fee_non_refundable:false,
  total:100
});
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

const cancelOrder=fs.readFileSync(path.join(__dirname,'api/cancel-order.js'),'utf8');
for(const field of ['cancellation_reason','cancelled_at','refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])assert.ok(cancelOrder.includes(field),`Cancellation must persist ${field}`);

const refundStatus=fs.readFileSync(path.join(__dirname,'api/refund-status.js'),'utf8');
for(const field of ['refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])assert.ok(refundStatus.includes(field),`Refund reconciliation must persist ${field}`);

console.log('Fashion_Fussion backend pricing/security/refund audit tests passed');

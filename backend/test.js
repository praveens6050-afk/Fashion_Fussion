const assert=require('assert');
const {paymentPricing,normalizePaymentMethod,roundMoney,normalizeCartRequest,cors}=require('./lib');

assert.deepStrictEqual(paymentPricing(100,'prepaid'),{
  payment_method:'prepaid',
  payment_handling_fee:49,
  prepaid_discount:49,
  cod_fee:0,
  cod_fee_non_refundable:false,
  total:100
});
assert.deepStrictEqual(paymentPricing(100,'cod'),{
  payment_method:'cod',
  payment_handling_fee:49,
  prepaid_discount:0,
  cod_fee:49,
  cod_fee_non_refundable:true,
  total:149
});
assert.strictEqual(paymentPricing(0,'prepaid').total,0);
assert.strictEqual(paymentPricing(0,'cod').total,49);
assert.strictEqual(normalizePaymentMethod(undefined),'prepaid');
assert.throws(()=>normalizePaymentMethod('upi'),/Invalid payment method/);
assert.strictEqual(roundMoney(10.005),10.01);

assert.deepStrictEqual(normalizeCartRequest([{id:9,qty:2}]),[{id:'9',qty:2}]);
assert.throws(()=>normalizeCartRequest([{id:9,qty:20},{id:9,qty:1}]),/Duplicate product ID/);
assert.throws(()=>normalizeCartRequest(Array.from({length:51},(_,i)=>({id:i+1,qty:1}))),/Too many cart items/);
assert.throws(()=>normalizeCartRequest([{id:9,qty:21}]),/Invalid quantity/);

function fakeRes(){return{headers:{},setHeader(name,value){this.headers[name]=value}}}
const goodRes=fakeRes();
assert.strictEqual(cors({headers:{origin:'https://praveens6050-afk.github.io'}},goodRes),true);
assert.strictEqual(goodRes.headers['Access-Control-Allow-Origin'],'https://praveens6050-afk.github.io');
assert.strictEqual(goodRes.headers['Cache-Control'],'no-store');
assert.strictEqual(goodRes.headers['X-Content-Type-Options'],'nosniff');
const badRes=fakeRes();
assert.strictEqual(cors({headers:{origin:'https://evil.example'}},badRes),false);
assert.strictEqual(badRes.headers['Access-Control-Allow-Origin'],undefined);

console.log('Fashion_Fussion backend pricing/security tests passed');

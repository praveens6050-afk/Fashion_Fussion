const assert=require('assert');
const {paymentPricing,normalizePaymentMethod,roundMoney}=require('./lib');

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
console.log('Fashion_Fussion backend pricing tests passed');

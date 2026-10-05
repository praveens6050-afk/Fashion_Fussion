const assert = require('assert');
const economics = require('./seller-net-payout-calculator.js');

const zeroCommission = economics.calculateSellerNetPayout({
  sellingPrice: 1000,
  marketplaceCommissionRate: 0,
  paymentProcessingRate: 2,
  shippingCost: 60,
  expectedReturnRate: 10,
  returnHandlingCost: 100,
  gstOnPlatformFeesRate: 18
});
assert.strictEqual(zeroCommission.marketplaceCommission, 0);
assert.strictEqual(zeroCommission.paymentProcessing, 20);
assert.strictEqual(zeroCommission.expectedReturnReserve, 10);
assert.strictEqual(zeroCommission.gstOnPlatformFees, 3.6);
assert.strictEqual(zeroCommission.estimatedNetPayout, 906.4);

const paidCommission = economics.calculateSellerNetPayout({
  sellingPrice: 2000,
  marketplaceCommissionRate: 3,
  paymentProcessingRate: 2,
  paymentProcessingFixed: 5,
  shippingCost: 80,
  gstOnPlatformFeesRate: 18
});
assert.strictEqual(paidCommission.marketplaceCommission, 60);
assert.strictEqual(paidCommission.paymentProcessing, 45);
assert.strictEqual(paidCommission.gstOnPlatformFees, 18.9);
assert.strictEqual(paidCommission.estimatedNetPayout, 1796.1);

assert.strictEqual(economics.calculateSellerNetPayout({ sellingPrice: -10 }).estimatedNetPayout, 0);
console.log('seller net payout calculator tests passed');

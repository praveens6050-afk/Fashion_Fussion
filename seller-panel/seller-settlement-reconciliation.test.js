'use strict';
const assert = require('node:assert/strict');
const { reconcileSettlement } = require('./seller-settlement-reconciliation');

const base = {
  gross_amount: 1000, fees_amount: 100, refunds_amount: 50, net_amount: 850,
  platform_commission_amount: 40, commission_gst_amount: 7.2,
  payment_fee_amount: 12.8, shipping_deduction_amount: 40,
  return_deduction_amount: 0, other_deduction_amount: 0
};
assert.deepEqual(
  (({netMatches, feeBreakdownMatches, needsReview}) => ({netMatches, feeBreakdownMatches, needsReview}))(reconcileSettlement(base)),
  {netMatches:true, feeBreakdownMatches:true, needsReview:false}
);
assert.equal(reconcileSettlement({...base, net_amount:851}).netMatches,false);
assert.equal(reconcileSettlement({...base, shipping_deduction_amount:41}).feeBreakdownMatches,false);
assert.equal(reconcileSettlement({...base, payment_fee_amount:null}).breakdownComplete,false);
assert.equal(reconcileSettlement({...base, gross_amount:1000.01}).netMatches,false);
assert.throws(()=>reconcileSettlement({...base, fees_amount:'invalid'}), TypeError);
console.log('seller settlement reconciliation tests passed');

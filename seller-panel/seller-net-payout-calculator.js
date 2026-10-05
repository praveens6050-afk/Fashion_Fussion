(function (global) {
  'use strict';

  const DEFAULTS = Object.freeze({
    marketplaceCommissionRate: 0,
    paymentProcessingRate: 0,
    paymentProcessingFixed: 0,
    shippingCost: 0,
    expectedReturnRate: 0,
    returnHandlingCost: 0,
    gstOnPlatformFeesRate: 18
  });

  function money(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function pct(value) {
    return Math.max(0, Math.min(100, Number(value) || 0)) / 100;
  }

  function calculateSellerNetPayout(input) {
    const x = Object.assign({}, DEFAULTS, input || {});
    const sellingPrice = Math.max(0, Number(x.sellingPrice) || 0);
    const commission = sellingPrice * pct(x.marketplaceCommissionRate);
    const paymentFee = sellingPrice * pct(x.paymentProcessingRate) + Math.max(0, Number(x.paymentProcessingFixed) || 0);
    const shipping = Math.max(0, Number(x.shippingCost) || 0);
    const returnReserve = pct(x.expectedReturnRate) * Math.max(0, Number(x.returnHandlingCost) || 0);
    const taxablePlatformFees = commission + paymentFee;
    const gstOnPlatformFees = taxablePlatformFees * pct(x.gstOnPlatformFeesRate);
    const totalCosts = commission + paymentFee + shipping + returnReserve + gstOnPlatformFees;
    const netPayout = Math.max(0, sellingPrice - totalCosts);

    return {
      sellingPrice: money(sellingPrice),
      marketplaceCommission: money(commission),
      paymentProcessing: money(paymentFee),
      shipping: money(shipping),
      expectedReturnReserve: money(returnReserve),
      gstOnPlatformFees: money(gstOnPlatformFees),
      totalEstimatedCosts: money(totalCosts),
      estimatedNetPayout: money(netPayout),
      effectiveCostRate: sellingPrice ? money((totalCosts / sellingPrice) * 100) : 0
    };
  }

  global.FashionFussionSellerEconomics = Object.freeze({
    defaults: DEFAULTS,
    calculateSellerNetPayout
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.FashionFussionSellerEconomics;
  }
})(typeof window !== 'undefined' ? window : globalThis);

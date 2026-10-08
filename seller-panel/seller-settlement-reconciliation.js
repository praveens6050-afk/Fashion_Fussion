'use strict';

// Read-only reconciliation helper. This does not determine or change payouts.
// All figures must come from the server-authoritative settlement ledger.
function amount(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Invalid settlement amount');
  return Math.round((number + Number.EPSILON) * 100);
}

function reconcileSettlement(row) {
  if (!row || typeof row !== 'object') throw new TypeError('Settlement record required');
  const gross = amount(row.gross_amount);
  const fees = amount(row.fees_amount);
  const refunds = amount(row.refunds_amount);
  const net = amount(row.net_amount);
  const breakdownKeys = [
    'platform_commission_amount', 'commission_gst_amount',
    'payment_fee_amount', 'shipping_deduction_amount',
    'return_deduction_amount', 'other_deduction_amount'
  ];
  const breakdownPresent = breakdownKeys.every(key => row[key] !== null && row[key] !== undefined);
  const breakdown = breakdownKeys.reduce((sum, key) => sum + amount(row[key]), 0);
  // The return deduction may be accounted for as fees or refunds depending on
  // settlement policy; flag differences for review rather than guessing.
  return {
    netMatches: gross - fees - refunds === net,
    feeBreakdownMatches: breakdownPresent ? breakdown === fees : null,
    breakdownComplete: breakdownPresent,
    grossPaise: gross, feesPaise: fees, refundsPaise: refunds,
    netPaise: net, breakdownPaise: breakdown,
    needsReview: gross - fees - refunds !== net || !breakdownPresent || breakdown !== fees
  };
}

module.exports = { reconcileSettlement };

const refundStatus = require('../backend/api/refund-status.js');
const returnRefundStatus = require('../backend/api/return-refund-status.js');

module.exports = function refundStatusRouter(req, res) {
  const url = new URL(req.url || '/api/refund-status', 'https://fashion-fussion.local');
  if (url.searchParams.get('mode') === 'return-refund') {
    return returnRefundStatus(req, res);
  }
  return refundStatus(req, res);
};

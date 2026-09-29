const { applySecurityHeaders, json } = require('../lib');
const { isPayUConfigured, PAYU_ENV } = require('../payu');

function payuEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.PAYU_ENABLED || '').trim());
}

module.exports = async function paymentConfig(req, res) {
  applySecurityHeaders(res);
  if (req.method !== 'GET') return json(req, res, 405, { error: 'Method not allowed' });
  const ready = payuEnabled() && isPayUConfigured();
  return json(req, res, 200, {
    provider: ready ? 'payu' : 'razorpay',
    payu_ready: ready,
    payu_environment: ready ? PAYU_ENV : null
  });
};

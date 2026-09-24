const { withAdminRequest } = require('../backend/admin-auth-bootstrap.js');

function preflight(req, res) {
  const origin = String(req?.headers?.origin || '').trim();
  const allowed = String(process.env.ALLOWED_ORIGIN || 'https://admin.fashionfussion.in')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 204;
  return res.end();
}

module.exports = async function adminAction(req, res) {
  if (req.method === 'OPTIONS') return preflight(req, res);
  try {
    return await withAdminRequest(req, async () => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || '').trim();

      if (action === 'connection_test') {
        return require('../backend/api/shiprocket-health.js')(req, res);
      }
      if (action === 'checkout_health') {
        return require('../backend/api/checkout-health.js')(req, res);
      }
      if (['config','admin_list','create_shipment','check_serviceability','assign_awb','request_pickup','sync_tracking'].includes(action)) {
        return require('../backend/api/shipping.js')(req, res);
      }
      if (body.quote_id != null || action === 'finalize' || action === 'save_state') {
        return require('../backend/api/admin-business-quote-action.js')(req, res);
      }
      return require('../backend/api/admin-order-action.js')(req, res);
    });
  } catch (error) {
    console.error('admin API router error:', error);
    if (res.headersSent) return;
    res.statusCode = error.status || 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: false, error: error?.message || 'Admin API failed to start' }));
  }
};

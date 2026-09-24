const { withAdminRequest } = require('../backend/admin-auth-bootstrap.js');

module.exports = async function processReturnRefund(req, res) {
  if (req.method === 'OPTIONS') {
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
  try {
    return await withAdminRequest(req, () => require('../backend/api/process-return-refund.js')(req, res));
  } catch (error) {
    if (res.headersSent) return;
    res.statusCode = error.status || 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: error?.message || 'Unable to process return refund' }));
  }
};

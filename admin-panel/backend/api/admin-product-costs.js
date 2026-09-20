const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVER_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGIN || 'https://admin.fashionfussion.in')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function cors(req, res) {
  applySecurityHeaders(res);
  const origin = String(req?.headers?.origin || '').trim();
  const allowed = !origin || ALLOWED_ORIGINS.includes(origin);
  if (origin && allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return allowed;
}

function json(req, res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  cors(req, res);
  res.end(JSON.stringify(body));
}

function assertServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVER_KEY) {
    const error = new Error('Supabase server configuration is missing');
    error.status = 500;
    throw error;
  }
}

async function requireAdminUser(req) {
  assertServerConfig();
  const origin = String(req?.headers?.origin || '').trim();
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    const error = new Error('Origin not allowed');
    error.status = 403;
    throw error;
  }

  const authHeader = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }

  const userResponse = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: {
      apikey: SUPABASE_SERVER_KEY,
      Authorization: authHeader
    }
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user?.id) {
    const error = new Error('Your login session has expired. Please sign in again.');
    error.status = 401;
    throw error;
  }

  const profileResponse = await fetch(
    SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=id,is_admin&limit=1',
    { headers: { apikey: SUPABASE_SERVER_KEY } }
  );
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok || !profiles?.[0]?.is_admin) {
    const error = new Error('Administrator access is required');
    error.status = 403;
    throw error;
  }
  return user;
}

module.exports = async function adminProductCosts(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });

  try {
    await requireAdminUser(req);
    const response = await fetch(
      SUPABASE_URL + '/rest/v1/products?select=id,cost&order=id.asc',
      { headers: { apikey: SUPABASE_SERVER_KEY } }
    );
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(rows?.message || 'Could not load product costs');
    return json(req, res, 200, { products: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    return json(req, res, error.status || 400, { error: error.message || 'Unable to load product costs' });
  }
};

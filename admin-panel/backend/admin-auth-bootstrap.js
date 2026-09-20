const { AsyncLocalStorage } = require('async_hooks');

const PROJECT_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const PROJECT_PUBLISHABLE_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
const requestContext = new AsyncLocalStorage();

function cleanHttpOrigin(value) {
  const raw = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

function normalizeSupabaseEnv() {
  const candidates = [
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.PUBLIC_SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_PROJECT_URL,
    PROJECT_URL
  ];
  for (const candidate of candidates) {
    const valid = cleanHttpOrigin(candidate);
    if (valid && valid.endsWith('.supabase.co')) {
      process.env.SUPABASE_URL = valid;
      return valid;
    }
  }
  process.env.SUPABASE_URL = PROJECT_URL;
  return PROJECT_URL;
}

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGIN || 'https://admin.fashionfussion.in,https://fashion-fussion-admin.vercel.app')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function accessToken(req) {
  const value = String(req?.headers?.authorization || req?.headers?.Authorization || '');
  if (!value.startsWith('Bearer ')) {
    const error = new Error('Please log in before continuing');
    error.status = 401;
    throw error;
  }
  const token = value.slice(7).trim();
  if (!token) {
    const error = new Error('Please log in before continuing');
    error.status = 401;
    throw error;
  }
  return token;
}

function headersForToken(token) {
  return {
    apikey: PROJECT_PUBLISHABLE_KEY,
    Authorization: 'Bearer ' + token
  };
}

function contextHeaders() {
  const token = requestContext.getStore()?.token;
  return token ? headersForToken(token) : { apikey: PROJECT_PUBLISHABLE_KEY };
}

const requestScopedHeaders = new Proxy({}, {
  ownKeys() {
    return Reflect.ownKeys(contextHeaders());
  },
  getOwnPropertyDescriptor(_target, key) {
    const headers = contextHeaders();
    if (!(key in headers)) return undefined;
    return { enumerable: true, configurable: true, value: headers[key] };
  },
  get(_target, key) {
    return contextHeaders()[key];
  }
});

async function getSupabaseUser(req) {
  const origin = String(req?.headers?.origin || '').trim();
  if (origin && !allowedOrigins().includes(origin)) {
    const error = new Error('Origin not allowed');
    error.status = 403;
    throw error;
  }
  const token = accessToken(req);
  const response = await fetch(PROJECT_URL + '/auth/v1/user', { headers: headersForToken(token) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    const error = new Error('Your login session has expired. Please log in again.');
    error.status = 401;
    throw error;
  }
  return data;
}

async function requireAdminUser(req) {
  const user = await getSupabaseUser(req);
  const token = accessToken(req);
  const response = await fetch(
    PROJECT_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=id,is_admin&limit=1',
    { headers: headersForToken(token) }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok || !rows?.[0]?.is_admin) {
    const error = new Error('Administrator access is required');
    error.status = 403;
    throw error;
  }
  return user;
}

function installAdminAuth() {
  normalizeSupabaseEnv();
  const lib = require('./lib');
  lib.serverHeaders = requestScopedHeaders;
  lib.getSupabaseUser = getSupabaseUser;
  lib.requireAdminUser = requireAdminUser;
  return lib;
}

async function withAdminRequest(req, fn) {
  normalizeSupabaseEnv();
  const token = accessToken(req);
  installAdminAuth();
  return requestContext.run({ token }, fn);
}

module.exports = installAdminAuth;
module.exports.withAdminRequest = withAdminRequest;
module.exports.accessToken = accessToken;
module.exports.headersForToken = headersForToken;
module.exports.PROJECT_URL = PROJECT_URL;
module.exports.PROJECT_PUBLISHABLE_KEY = PROJECT_PUBLISHABLE_KEY;

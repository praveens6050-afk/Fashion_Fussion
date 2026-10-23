'use strict';

const FULFILLMENT_NEXT = {
  ordered: ['packed'],
  packed: ['shipped'],
  shipped: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: []
};
const PAYMENT_EXCEPTION_RESOLUTIONS = new Set([
  'processor_refund_confirmed',
  'duplicate_or_false_positive',
  'support_review_completed'
]);
const MAX_BODY_BYTES = 65536;

function json(body, status, origin, allowOrigin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin'
  };
  if (origin && allowOrigin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status: status, headers: headers });
}

function allowedOrigin(request, env) {
  const origin = String(request.headers.get('Origin') || '').trim();
  if (!origin) return { origin: '', allowed: true };
  let requestOrigin = '';
  try { requestOrigin = new URL(request.url).origin; } catch {}
  const configured = String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return { origin: origin, allowed: origin === requestOrigin || configured.includes(origin) };
}

function tokenProject(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return '';
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return new URL(String(payload.iss || '')).origin;
  } catch {
    return '';
  }
}

function errorResult(error, origin, allowOrigin) {
  const status = Number(error && error.status);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
  return json({ ok: false, error: error && error.message ? String(error.message) : 'Order action failed' }, safeStatus, origin, allowOrigin);
}

function requiredAuth(request) {
  const value = String(request.headers.get('Authorization') || '');
  if (!value.startsWith('Bearer ') || !value.slice(7).trim()) {
    const error = new Error('Please sign in again');
    error.status = 401;
    throw error;
  }
  return value.slice(7).trim();
}

function supabaseConfig(env) {
  let base = '';
  try {
    const parsed = new URL(String(env.SUPABASE_URL || ''));
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co')) base = parsed.origin;
  } catch {}
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '');
  if (!base || !key) {
    const error = new Error('Admin order actions are not configured for this deployment');
    error.status = 503;
    throw error;
  }
  return { base: base, key: key };
}

async function verifyAdmin(base, key, token) {
  const headers = { apikey: key, Authorization: 'Bearer ' + token };
  const userResponse = await fetch(base + '/auth/v1/user', { headers: headers });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user || !user.id) {
    const error = new Error('Your login session has expired. Please sign in again');
    error.status = 401;
    throw error;
  }
  const profileResponse = await fetch(
    base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=is_admin&limit=1',
    { headers: headers }
  );
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok || !profiles || profiles[0]?.is_admin !== true) {
    const error = new Error('Administrator access is required');
    error.status = 403;
    throw error;
  }
  return headers;
}

function upstreamError(data, fallback, status) {
  const message = data && (data.message || data.error_description || data.error);
  const error = new Error(typeof message === 'string' ? message : fallback);
  error.status = status || 502;
  return error;
}

async function requestSupabase(base, headers, path, options) {
  const response = await fetch(base + '/rest/v1/' + path, Object.assign({}, options || {}, {
    headers: Object.assign({}, headers, options && options.headers || {})
  }));
  const data = await response.json().catch(() => null);
  if (!response.ok) throw upstreamError(data, 'Order database request failed', response.status);
  return data;
}

async function rpc(base, headers, name, args) {
  return requestSupabase(base, headers, 'rpc/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  });
}

async function getOrder(base, headers, id, columns) {
  const rows = await requestSupabase(base, headers,
    'orders?id=eq.' + encodeURIComponent(id) +
    '&select=' + (columns || 'id,user_id,status,payment_method,fulfillment_status') + '&limit=1');
  if (!rows || !rows[0]) {
    const error = new Error('Order not found');
    error.status = 404;
    throw error;
  }
  return rows[0];
}

function validatePaymentState(order) {
  const method = String(order.payment_method || '').toLowerCase();
  const status = String(order.status || '').toLowerCase();
  if (method === 'prepaid' && status !== 'paid') throw new Error('Only paid prepaid orders can advance fulfillment');
  if (method === 'cod' && !['cod_pending', 'cod_collected'].includes(status)) throw new Error('This COD order cannot advance fulfillment');
  if (!['prepaid', 'cod'].includes(method)) throw new Error('Unsupported payment method');
}

async function updateFulfillment(base, headers, id, status) {
  const next = String(status || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FULFILLMENT_NEXT, next)) throw new Error('Invalid fulfillment status');
  if (next === 'cancelled') throw new Error('Use the dedicated cancellation action for cancellations');
  const order = await getOrder(base, headers, id);
  validatePaymentState(order);
  const current = String(order.fulfillment_status || 'ordered').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FULFILLMENT_NEXT, current)) throw new Error('Current fulfillment status is invalid');
  if (current === next) return { order_id: id, fulfillment_status: current, unchanged: true };
  if (!FULFILLMENT_NEXT[current].includes(next)) throw new Error('Invalid fulfillment transition from ' + current + ' to ' + next);
  const rows = await requestSupabase(base, headers,
    'orders?id=eq.' + encodeURIComponent(id) + '&fulfillment_status=eq.' + encodeURIComponent(current),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ fulfillment_status: next, fulfillment_updated_at: new Date().toISOString() })
    });
  if (!rows || !rows.length) {
    const error = new Error('Order changed before this update. Refresh and try again');
    error.status = 409;
    throw error;
  }
  return { order_id: id, fulfillment_status: next };
}

async function reconcileRefund(base, headers, env, id) {
  const order = await getOrder(base, headers, id,
    'id,status,payment_method,fulfillment_status,refund_id,razorpay_payment_id');
  const current = String(order.status || '').toLowerCase();
  if (order.payment_method !== 'prepaid' ||
      String(order.fulfillment_status || '').toLowerCase() !== 'cancelled' ||
      !['refund_initiated', 'refund_pending', 'refund_failed', 'refunded'].includes(current)) {
    const error = new Error('Order is not in a prepaid refund recovery state');
    error.status = 409;
    throw error;
  }
  if (!order.refund_id) {
    const error = new Error('No processor refund ID is stored. Manual review is required before any retry');
    error.status = 409;
    throw error;
  }
  const keyId = String(env.RAZORPAY_KEY_ID || '');
  const keySecret = String(env.RAZORPAY_KEY_SECRET || '');
  if (!keyId || !keySecret) {
    const error = new Error('Refund service is not configured for this deployment');
    error.status = 503;
    throw error;
  }
  const auth = 'Basic ' + btoa(keyId + ':' + keySecret);
  const response = await fetch('https://api.razorpay.com/v1/refunds/' + encodeURIComponent(order.refund_id), {
    headers: { Authorization: auth }
  });
  const refund = await response.json().catch(() => null);
  if (!response.ok || !refund || !refund.id) throw upstreamError(refund && refund.error, 'Refund status could not be fetched', response.status || 502);
  if (order.razorpay_payment_id && refund.payment_id && refund.payment_id !== order.razorpay_payment_id) {
    const error = new Error('Refund belongs to a different payment');
    error.status = 409;
    throw error;
  }
  const processorStatus = String(refund.status || '').toLowerCase();
  if (!['pending', 'processed', 'failed'].includes(processorStatus)) {
    const error = new Error('Unknown refund status');
    error.status = 409;
    throw error;
  }
  const next = processorStatus === 'processed' ? 'refunded' :
    processorStatus === 'failed' ? 'refund_failed' : 'refund_pending';
  const acquirer = refund.acquirer_data || {};
  const reference = acquirer.arn || acquirer.rrn || acquirer.utr || null;
  const patch = {
    status: next,
    refund_status: processorStatus,
    refund_updated_at: new Date().toISOString(),
    refund_reference: reference
  };
  if (Number.isFinite(Number(refund.amount))) patch.refund_amount = Number(refund.amount) / 100;
  const rows = await requestSupabase(base, headers,
    'orders?id=eq.' + encodeURIComponent(id) +
    '&refund_id=eq.' + encodeURIComponent(order.refund_id) +
    '&fulfillment_status=eq.cancelled',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    });
  if (!rows || !rows.length) {
    const error = new Error('Order changed before refund reconciliation');
    error.status = 409;
    throw error;
  }
  return {
    order_id: id,
    status: next,
    processor_refund_status: processorStatus,
    refund_id: refund.id,
    refund_reference: reference,
    payment_state_changed: next !== current
  };
}

async function handle(request, env, origin, allowOrigin) {
  const token = requiredAuth(request);
  const config = supabaseConfig(env);
  if (tokenProject(token) !== config.base) {
    const error = new Error('This preview is connected to a different Supabase project than this admin session. No order data was changed');
    error.status = 409;
    throw error;
  }
  const headers = await verifyAdmin(config.base, config.key, token);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    const error = new Error('Request body is too large');
    error.status = 413;
    throw error;
  }
  let body;
  try { body = JSON.parse(text || '{}'); }
  catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
  const action = String(body.action || '').trim();
  if (action === 'list_payment_exceptions') {
    const rows = await rpc(config.base, headers, 'admin_list_payment_exceptions');
    return json({ ok: true, action: action, exceptions: Array.isArray(rows) ? rows : [] }, 200, origin, allowOrigin);
  }
  if (action === 'resolve_payment_exception') {
    const exceptionId = Number(body.exception_id);
    const resolutionCode = String(body.resolution_code || '').trim();
    const note = String(body.resolution_note || '').trim();
    if (!Number.isInteger(exceptionId) || exceptionId < 1) throw new Error('Invalid payment exception ID');
    if (!PAYMENT_EXCEPTION_RESOLUTIONS.has(resolutionCode)) throw new Error('Invalid resolution code');
    if (note.length < 8 || note.length > 500) throw new Error('Resolution note must be 8 to 500 characters');
    const result = await rpc(config.base, headers, 'admin_resolve_payment_exception', {
      p_exception_id: exceptionId,
      p_resolution_code: resolutionCode,
      p_resolution_note: note
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || !row.exception_id) {
      const error = new Error('Payment exception could not be resolved');
      error.status = 409;
      throw error;
    }
    return json({
      ok: true,
      action: action,
      exception_id: row.exception_id,
      order_id: row.order_id,
      status: row.status,
      payment_state_changed: false
    }, 200, origin, allowOrigin);
  }

  const id = Number(body.order_id);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid order ID');
  if (!['collect_cod', 'cancel_cod', 'update_fulfillment', 'reconcile_cancelled_resources', 'reconcile_refund_processor'].includes(action)) {
    throw new Error('Invalid order action');
  }
  if (action === 'update_fulfillment') {
    return json({ ok: true, action: action, ...await updateFulfillment(config.base, headers, id, body.fulfillment_status) }, 200, origin, allowOrigin);
  }
  if (action === 'reconcile_cancelled_resources') {
    await rpc(config.base, headers, 'admin_reconcile_cancelled_order_resources', { p_order_id: id });
    const order = await getOrder(config.base, headers, id);
    return json({
      ok: true,
      action: action,
      order_id: id,
      status: order.status,
      fulfillment_status: order.fulfillment_status,
      resources_reconciled: true,
      payment_state_changed: false
    }, 200, origin, allowOrigin);
  }
  if (action === 'reconcile_refund_processor') {
    return json({ ok: true, action: action, ...await reconcileRefund(config.base, headers, env, id) }, 200, origin, allowOrigin);
  }
  await rpc(config.base, headers, action === 'collect_cod' ? 'admin_complete_cod_order' : 'admin_cancel_cod_order', {
    p_order_id: id
  });
  return json({ ok: true, order_id: id, action: action }, 200, origin, allowOrigin);
}

export async function onRequest({ request, env }) {
  const originCheck = allowedOrigin(request, env);
  const origin = originCheck.origin;
  if (!originCheck.allowed) {
    return json({ ok: false, error: 'Origin not allowed' }, 403, origin, false);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
        'Vary': 'Origin'
      }
    });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405, origin, Boolean(origin));
  }
  try {
    return await handle(request, env, origin, Boolean(origin));
  } catch (error) {
    return errorResult(error, origin, Boolean(origin));
  }
}

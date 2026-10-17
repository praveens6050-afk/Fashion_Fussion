function json(body, status, origin, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Vary': 'Origin',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      ...headers
    }
  });
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
  return [...new Set(configured)];
}

export async function onRequestOptions({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigins(env).includes(origin)) {
    return json({ ok: false, error: 'Origin not allowed' }, 403, '');
  }
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

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigins(env).includes(origin)) {
    return json({ ok: false, error: 'Origin not allowed' }, 403, '');
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) {
    return json({ ok: false, error: 'Please sign in again' }, 401, origin);
  }

  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '');
  if (!base || !key || !allowedOrigins(env).length) {
    return json({ ok: false, error: 'CRM notification diagnostics are not configured' }, 503, origin);
  }
  const headers = { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' };

  try {
    const userResponse = await fetch(base + '/auth/v1/user', {
      headers: { apikey: key, Authorization: authorization }
    });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id) {
      return json({ ok: false, error: 'Please sign in again' }, 401, origin);
    }

    const profileResponse = await fetch(
      base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=is_admin&limit=1',
      { headers: { apikey: key, Authorization: authorization } }
    );
    const profiles = await profileResponse.json().catch(() => []);
    if (!profileResponse.ok || profiles?.[0]?.is_admin !== true) {
      return json({ ok: false, error: 'Administrator access is required' }, 403, origin);
    }

    const rpcResponse = await fetch(base + '/rest/v1/rpc/admin_crm_notification_snapshot', {
      method: 'POST',
      headers,
      body: '{}'
    });
    if (!rpcResponse.ok) {
      // Never forward raw database/provider errors to the browser.
      return json({
        ok: false,
        error: rpcResponse.status === 401 ? 'Please sign in again' :
          rpcResponse.status === 403 ? 'Administrator access is required' :
          'Notification diagnostics are temporarily unavailable'
      }, rpcResponse.status === 401 ? 401 : rpcResponse.status === 403 ? 403 : 503, origin);
    }

    const data = await rpcResponse.json().catch(() => null);
    return json({ ok: true, data: data && typeof data === 'object' ? data : {} }, 200, origin);
  } catch {
    return json({ ok: false, error: 'CRM notification diagnostics are unavailable' }, 503, origin);
  }
}

export async function onRequest({ request }) {
  return json({ ok: false, error: 'Method not allowed' }, 405, request.headers.get('Origin') || '', {
    'Allow': 'POST, OPTIONS',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
}

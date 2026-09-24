const ALLOWED_ORIGIN = 'https://admin.fashionfussion.in';

function cors(origin: string | null) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status = 200, origin: string | null = null, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors(origin),
      ...extra,
    },
  });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403, headers: cors(origin) });
    return new Response(null, { status: 204, headers: cors(origin) });
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405, origin, { 'Allow': 'POST, OPTIONS' });
  if (origin !== ALLOWED_ORIGIN) return json({ ok: false, error: 'Origin not allowed' }, 403, origin);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid request body' }, 400, origin); }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@')) return json({ ok: false, error: 'Valid email is required' }, 400, origin);

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'Login protection is not configured' }, 503, origin);

  const forwarded = req.headers.get('x-forwarded-for') || '';
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || forwarded.split(',')[0] || 'unknown').trim().slice(0, 96);
  const rateKey = 'admin-login:' + await sha256Hex(`${ip}|${email}`);

  let rpcResponse: Response;
  try {
    rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_admin_login_rate_limit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ p_key: rateKey, p_limit: 8, p_window_seconds: 600 }),
    });
  } catch {
    return json({ ok: false, error: 'Login protection is unavailable' }, 503, origin);
  }

  if (!rpcResponse.ok) return json({ ok: false, error: 'Login protection is unavailable' }, 503, origin);

  let rows: unknown;
  try { rows = await rpcResponse.json(); } catch { return json({ ok: false, error: 'Login protection is unavailable' }, 503, origin); }
  const result = Array.isArray(rows) ? rows[0] : rows as Record<string, unknown>;
  const allowed = (result as any)?.allowed === true;
  const remaining = Math.max(0, Number((result as any)?.remaining || 0));
  const retryAfter = Math.max(0, Number((result as any)?.retry_after_seconds || 0));
  const rateHeaders = {
    'X-RateLimit-Limit': '8',
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Policy': '8;w=600',
  };

  if (!allowed) {
    return json({ ok: false, allowed: false, retry_after_seconds: retryAfter }, 429, origin, {
      ...rateHeaders,
      'Retry-After': String(Math.max(1, retryAfter)),
    });
  }

  return json({ ok: true, allowed: true, remaining }, 200, origin, rateHeaders);
});

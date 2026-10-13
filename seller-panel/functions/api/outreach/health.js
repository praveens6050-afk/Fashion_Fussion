function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value || '');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function authorized(request, env) {
  if (!env.OUTREACH_API_TOKEN) return false;
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [a, b] = await Promise.all([digest(supplied), digest(env.OUTREACH_API_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await authorized(request, env))) return json({ error: 'Unauthorized' }, 401);

  const zohoRequired = [
    'ZOHO_CLIENT_ID',
    'ZOHO_CLIENT_SECRET',
    'ZOHO_REFRESH_TOKEN',
    'ZOHO_MAIL_ACCOUNT_ID',
    'ZOHO_MAIL_FROM_ADDRESS',
  ];
  const whatsappRequired = [
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_GRAPH_VERSION',
  ];

  const status = {
    outreachAuth: Boolean(env.OUTREACH_API_TOKEN),
    zoho: {
      ready: zohoRequired.every((key) => Boolean(env[key])),
      missing: zohoRequired.filter((key) => !env[key]),
      accountsBase: env.ZOHO_ACCOUNTS_BASE_URL || 'https://accounts.zoho.in',
      mailBase: env.ZOHO_MAIL_BASE_URL || 'https://mail.zoho.in',
    },
    whatsapp: {
      ready: whatsappRequired.every((key) => Boolean(env[key])),
      missing: whatsappRequired.filter((key) => !env[key]),
    },
  };

  return json(status);
}

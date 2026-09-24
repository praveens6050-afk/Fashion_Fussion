const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');

if (!EMAIL || !PASSWORD) throw new Error('SELLER_E2E_EMAIL and SELLER_E2E_PASSWORD are required.');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    const response = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response || !response.ok()) throw new Error(`Seller login returned ${response && response.status()}`);

    await page.waitForFunction(() => Boolean(window.ffSellerSupabaseReady), null, { timeout: 15000 });
    const result = await page.evaluate(async ({ email, password }) => {
      const client = await window.ffSellerSupabaseReady;
      if (!client) return { ok: false, stage: 'startup', message: 'Seller authentication client unavailable.' };

      const { data, error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error || !data?.user) {
        return {
          ok: false,
          stage: 'credentials',
          message: error?.message || 'Authentication failed without a user session.',
          code: error?.code || null,
          status: error?.status || null
        };
      }

      const user = data.user;
      const { data: profile, error: profileError } = await client
        .from('seller_profiles')
        .select('user_id,status')
        .eq('user_id', user.id)
        .maybeSingle();

      const registrationIntent = Boolean(user.user_metadata?.seller_registration_intent);
      await client.auth.signOut().catch(() => {});

      if (profileError) {
        return {
          ok: false,
          stage: 'profile-query',
          message: profileError.message || 'Seller profile lookup failed.',
          code: profileError.code || null
        };
      }
      if (!profile) {
        return {
          ok: false,
          stage: 'seller-profile',
          message: registrationIntent
            ? 'Authenticated account has seller registration intent but no seller profile row.'
            : 'Authenticated account is not registered as a seller.',
          registrationIntent
        };
      }
      if (profile.status !== 'active') {
        return {
          ok: false,
          stage: 'seller-status',
          message: `Seller account status is ${String(profile.status || 'missing')}; active is required.`,
          sellerStatus: profile.status || null
        };
      }
      return { ok: true, stage: 'ready', message: 'Credentials valid and seller profile is active.' };
    }, { email: EMAIL, password: PASSWORD });

    if (!result.ok) {
      const safe = JSON.stringify(result);
      throw new Error(`Seller auth preflight failed: ${safe}`);
    }
    console.log(`PASS seller auth preflight: ${result.message}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

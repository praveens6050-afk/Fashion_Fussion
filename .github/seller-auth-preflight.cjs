const { chromium } = require('playwright');

const BASE = 'https://seller.fashionfussion.in';
const EMAIL = String(process.env.SELLER_E2E_EMAIL || '').trim();
const PASSWORD = String(process.env.SELLER_E2E_PASSWORD || '');

if (!EMAIL || !PASSWORD) throw new Error('SELLER_E2E_EMAIL and SELLER_E2E_PASSWORD are required.');

function cleanPath(value) {
  try { return new URL(value).pathname.replace(/\.html$/i, '') || '/'; }
  catch { return ''; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const navigations = [];
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations.push(cleanPath(frame.url()));
  });

  try {
    let response = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
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

    if (!result.ok) throw new Error(`Seller auth preflight failed: ${JSON.stringify(result)}`);
    console.log(`PASS seller auth eligibility: ${result.message}`);

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#loginSubmit')?.disabled, null, { timeout: 15000 });
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#loginSubmit').click();

    const deadline = Date.now() + 25000;
    let reachedDashboard = false;
    while (Date.now() < deadline) {
      const path = cleanPath(page.url());
      if (!['/login', '/login/'].includes(path)) {
        reachedDashboard = true;
        break;
      }
      const message = ((await page.locator('#authMessage').textContent().catch(() => '')) || '').trim();
      if (message && !/^signing in/i.test(message)) break;
      await page.waitForTimeout(250);
    }

    if (reachedDashboard) {
      await page.waitForTimeout(2500);
      if (['/login', '/login/'].includes(cleanPath(page.url()))) reachedDashboard = false;
    }

    if (!reachedDashboard) {
      const state = await page.evaluate(async () => {
        const uiLocal = Boolean(localStorage.getItem('ff_seller_session_v1'));
        const uiSession = Boolean(sessionStorage.getItem('ff_seller_session_v1'));
        let authSession = false;
        let authError = null;
        try {
          const client = window.supabaseClient || await window.ffSellerSupabaseReady;
          const { data, error } = await client.auth.getSession();
          authSession = Boolean(data?.session?.user);
          authError = error?.message || null;
        } catch (error) {
          authError = error?.message || String(error);
        }
        return {
          path: location.pathname,
          authMessage: (document.getElementById('authMessage')?.textContent || '').trim(),
          submitDisabled: Boolean(document.getElementById('loginSubmit')?.disabled),
          rememberMode: localStorage.getItem('ff_seller_remember_mode'),
          uiLocal,
          uiSession,
          authSession,
          authError
        };
      });
      throw new Error(`Seller UI login handoff failed: ${JSON.stringify({ ...state, navigations })}`);
    }

    console.log(`PASS seller UI login handoff: ${cleanPath(page.url())}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

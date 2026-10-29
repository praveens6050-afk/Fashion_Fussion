const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`pageerror ${viewport.width}: ${error.message}`));
      await page.route('https://gmdevprqtvoshbbytsxf.supabase.co/**', route => route.abort());
      const response = await page.goto(BASE + '/admin-panel/index.html', { waitUntil: 'domcontentloaded' });
      if (!response || !response.ok()) throw new Error('CRM entry point did not return HTTP success');
      await page.waitForURL(url => url.pathname.endsWith('/admin-panel/crm-login.html'), { timeout: 5000 });
      for (const selector of ['#form', '#email', '#password', '#submit']) {
        if (!(await page.locator(selector).count())) throw new Error(`CRM login missing ${selector}`);
      }
      await page.goto(BASE + '/admin-panel/crm.html', { waitUntil: 'domcontentloaded' });
      if ((await page.locator('#dashboard').getAttribute('data-admin-ready')) !== 'false') {
        throw new Error('CRM dashboard is not fail-closed before authorization');
      }
      if (await page.locator('#dashboard').isVisible()) throw new Error('CRM dashboard became visible without authorization');
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth
      }));
      if (dimensions.page > dimensions.viewport + 1) throw new Error(`CRM page overflows at ${viewport.width}px: ${JSON.stringify(dimensions)}`);
      await context.close();
    }
    const moduleStubs = [
      'admin-crm-whatsapp-inbox.js',
      'crm-navigation.js',
      'crm-unified-inbox.js',
      'crm-team-management.js',
      'crm-sales-workspace.js'
    ];
    async function openMockedCrm(profileMode) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`mocked CRM pageerror: ${error.message}`));
      const profileResult = profileMode === 'pending'
        ? 'return new Promise(() => {});'
        : "return Promise.resolve({ data: { is_admin: true }, error: null });";
      const config = `(() => {
        const db = {
          auth: {
            getSession: async () => ({ data: { session: { user: { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.test' } } }, error: null }),
            signOut: async () => ({ error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
          },
          from: () => ({
            select() { return this; },
            eq() { return this; },
            abortSignal() { return this; },
            maybeSingle() { ${profileResult} }
          })
        };
        window.supabaseClient = db;
        window.ffAdminSupabaseReady = Promise.resolve(db);
      })();`;
      await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'application/javascript', body: config }));
      await page.route('**/admin-crm-whatsapp-inbox.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
      await page.route('**/crm-navigation.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
      for (const module of moduleStubs) {
        await page.route(`**/${module}*`, route => route.fulfill({ contentType: 'application/javascript', body: '' }));
      }
      await page.goto(BASE + '/admin-panel/crm.html', { waitUntil: 'domcontentloaded' });
      return { context, page };
    }

    const success = await openMockedCrm('admin');
    await success.page.waitForFunction(() => document.getElementById('dashboard')?.dataset.adminReady === 'true', { timeout: 5000 });
    if (!(await success.page.locator('#dashboard').isVisible())) throw new Error('Authorized CRM dashboard stayed hidden');
    if (!(await success.page.locator('#crmEmail').innerText()).includes('administrator')) throw new Error('Authorized admin role was not rendered');
    await success.context.close();

    const stalled = await openMockedCrm('pending');
    await stalled.page.locator('#accessDenied').waitFor({ state: 'visible', timeout: 12000 });
    if (!(await stalled.page.locator('#accessDeniedMessage').innerText()).includes('Administrator profile check timed out')) {
      throw new Error('Stalled CRM profile check did not show its timeout message');
    }
    if (await stalled.page.locator('#loadingScreen').isVisible()) throw new Error('Stalled CRM profile check left the loading screen visible');
    await stalled.context.close();

    if (failures.length) throw new Error(failures.join('\n'));
    console.log('CRM browser smoke passed: entry redirect, login controls, fail-closed authorization, and desktop/mobile overflow checks.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

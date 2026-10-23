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
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('CRM browser smoke passed: entry redirect, login controls, fail-closed authorization, and desktop/mobile overflow checks.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

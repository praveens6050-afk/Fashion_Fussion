'use strict';
(function () {
  const VERSION = '2026-10-27-auth-stall-timeout-1';
  window.__FF_CRM_AUTH_VERSION = VERSION;

  const $ = (id) => document.getElementById(id);
  const LOGIN_URL = 'crm-login.html';
  const ALLOWED_ROLES = ['customer_support', 'seller_support', 'sales', 'marketing'];

  function setProgress(state, message) {
    const dashboard = $('dashboard');
    if (dashboard) dashboard.dataset.crmAuthState = state;
    const label = $('crmEmail');
    if (label) label.textContent = message;
  }

  // A stalled fetch must not keep the CRM on its loading screen indefinitely.
  function withTimeout(value, ms, message, onTimeout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(result);
      };
      const timer = setTimeout(() => {
        try { if (onTimeout) onTimeout(); } catch (error) {
          console.warn('[CRM] Could not abort timed-out request:', error);
        }
        finish(reject, new Error(message));
      }, ms);
      Promise.resolve().then(() => value).then(
        (result) => finish(resolve, result),
        (error) => finish(reject, error)
      );
    });
  }

  function queryWithTimeout(query, ms, message) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller && query && typeof query.abortSignal === 'function') {
      query.abortSignal(controller.signal);
    }
    const pending = query && typeof query.maybeSingle === 'function' ? query.maybeSingle() : query;
    return withTimeout(pending, ms, message, () => {
      if (controller) controller.abort();
    });
  }

  function showDenied(message) {
    const loading = $('loadingScreen');
    const dashboard = $('dashboard');
    const denied = $('accessDenied');
    const detail = $('accessDeniedMessage');

    if (loading) loading.hidden = true;
    if (dashboard) {
      dashboard.hidden = true;
      dashboard.dataset.adminReady = 'false';
      dashboard.dataset.crmAuthState = 'denied';
    }
    if (detail) detail.textContent = message;
    if (denied) denied.hidden = false;
    const email = $('crmEmail');
    if (email) email.textContent = 'Access verification failed';
  }

  function redirectToLogin() {
    location.replace(LOGIN_URL);
  }

  async function getClient() {
    const ready = window.ffAdminSupabaseReady;
    const client = await withTimeout(
      ready || Promise.resolve(window.supabaseClient),
      12000,
      'Supabase did not initialize within 12 seconds. Refresh the page; if this continues, check the Supabase SDK request in DevTools.'
    );
    if (!client || !client.auth || typeof client.from !== 'function') {
      throw new Error('Supabase client is unavailable. Check supabase-config.js and the Supabase SDK.');
    }
    return client;
  }

  async function resolveRole(db, user) {
    if (!user || !user.id) return null;

    setProgress('checking-profile', 'Checking administrator access…');
    const profileResult = await queryWithTimeout(
      db.from('profiles').select('is_admin').eq('id', user.id),
      10000,
      'Administrator profile check timed out.'
    );
    if (!profileResult.error && profileResult.data && profileResult.data.is_admin === true) {
      return 'administrator';
    }

    setProgress('checking-membership', 'Checking CRM team membership…');
    const memberResult = await queryWithTimeout(
      db.from('crm_team_members').select('email,role,is_active').eq('user_id', user.id),
      10000,
      'CRM team membership check timed out.'
    );
    if (memberResult.error) {
      console.error('[CRM] Team membership query failed:', memberResult.error.message);
      throw new Error('Could not verify CRM team access. Check crm_team_members permissions and RLS policies.');
    }

    const member = memberResult.data;
    const sameEmail = String(member && member.email || '').trim().toLowerCase() ===
      String(user.email || '').trim().toLowerCase();
    if (!member || member.is_active !== true || !sameEmail || !ALLOWED_ROLES.includes(member.role)) {
      return null;
    }
    return member.role;
  }

  function loadScript(src, label) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load CRM module: ' + label));
      document.body.appendChild(script);
    });
  }

  async function init() {
    const loading = $('loadingScreen');
    const dashboard = $('dashboard');
    if (loading) loading.hidden = false;
    setProgress('checking-client', 'Connecting to CRM access service…');
    if (dashboard) {
      dashboard.hidden = true;
      dashboard.dataset.adminReady = 'false';
      dashboard.dataset.crmAuthState = 'checking';
    }

    const db = await getClient();
    setProgress('checking-session', 'Checking signed-in session…');
    const sessionResult = await withTimeout(
      db.auth.getSession(),
      10000,
      'Session check timed out. Refresh the page or sign in again.'
    );
    if (sessionResult.error) throw new Error('Could not restore your sign-in session. Please sign in again.');
    const user = sessionResult.data && sessionResult.data.session && sessionResult.data.session.user;
    if (!user) {
      showDenied('Your session is missing or expired. Please sign in with your authorized CRM account.');
      return;
    }

    let role;
    try {
      role = await withTimeout(resolveRole(db, user), 22000, 'CRM role verification timed out. Check Supabase connectivity and CRM table permissions.');
    } catch (error) {
      // Fail closed and show the message immediately; never wait for signOut to finish first.
      showDenied(error && error.message || 'Unable to verify CRM access.');
      void withTimeout(db.auth.signOut(), 4000, 'Sign-out cleanup timed out.').catch((signOutError) => {
        console.warn('[CRM] Sign-out cleanup did not complete:', signOutError.message);
      });
      return;
    }

    if (!role) {
      showDenied('This account has no active CRM team access. Ask a CRM administrator to verify your email and active team membership.');
      void withTimeout(db.auth.signOut(), 4000, 'Sign-out cleanup timed out.').catch((error) => {
        console.warn('[CRM] Sign-out cleanup did not complete:', error.message);
      });
      return;
    }

    const email = $('crmEmail');
    if (email) email.textContent = (user.email || 'CRM user') + ' · ' + role;
    setProgress('authorized', (user.email || 'CRM user') + ' · ' + role);
    if (dashboard) {
      dashboard.dataset.crmRole = role;
      dashboard.dataset.crmDepartment = role;
      dashboard.dataset.crmAuthState = 'authorized';
    }

    const sales = $('crmSalesWorkspace');
    const support = $('crmSupportWorkspace');
    const team = $('crmTeamManagement');
    if (sales) sales.hidden = !['sales', 'marketing', 'administrator'].includes(role);
    if (support) support.hidden = !['customer_support', 'seller_support'].includes(role);
    const supportTitle = $('crmSupportTitle');
    if (supportTitle) supportTitle.textContent = role === 'customer_support' ? 'Customer Support Queue' : 'Seller Support Queue';
    if (team) team.hidden = role !== 'administrator';

    if (loading) loading.hidden = true;
    const denied = $('accessDenied');
    if (denied) denied.hidden = true;
    if (dashboard) {
      dashboard.hidden = false;
      dashboard.dataset.adminReady = 'true';
    }
    document.dispatchEvent(new Event('ff-crm-ready'));

    const modules = [
      ['crm-unified-inbox.js?v=20261023-live-ready-1', 'unified inbox']
    ];
    if (role === 'administrator') modules.push(['crm-team-management.js?v=20261027-zoho-oauth-1', 'team management']);
    if (['sales', 'marketing', 'administrator'].includes(role)) modules.push(['crm-sales-workspace.js?v=20261023-live-ready-1', 'sales workspace']);
    if (['customer_support', 'seller_support'].includes(role)) modules.push(['crm-support-workspace.js?v=20261023-live-ready-1', 'support workspace']);

    // The authorization gate is complete; optional workspace failures should be visible but
    // must not leave the entire dashboard on its loading screen.
    for (const [src, label] of modules) {
      try {
        await withTimeout(loadScript(src, label), 10000, 'Loading ' + label + ' timed out.');
      } catch (error) {
        console.error('[CRM] Workspace module failed:', error);
        const notice = $('crmInboxNotice') || $('crmSupportNotice') || $('crmTeamNotice');
        if (notice) notice.textContent = error.message + ' Refresh the page or contact the CRM administrator.';
      }
    }

    db.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' || !nextSession || !nextSession.user) redirectToLogin();
    });
  }

  const logout = $('crmLogout');
  if (logout) logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      const db = await getClient();
      await withTimeout(db.auth.signOut(), 6000, 'Sign-out timed out.');
    } catch (error) {
      console.error('[CRM] Sign-out failed:', error);
    } finally {
      redirectToLogin();
    }
  });

  const goLogin = $('crmGoLogin');
  if (goLogin) goLogin.addEventListener('click', redirectToLogin);

  // Independent watchdog for unexpected stalls after this script starts.
  const watchdog = setTimeout(() => {
    const dashboard = $('dashboard');
    if (dashboard && dashboard.dataset.adminReady !== 'true') {
      showDenied('CRM access check did not finish within 25 seconds. Refresh the page; the last check is shown above.');
    }
  }, 25000);

  init().catch((error) => {
    console.error('[CRM] Access check failed:', error);
    showDenied(error && error.message || 'Unable to verify CRM access. Please sign in again.');
  }).finally(() => clearTimeout(watchdog));
})();
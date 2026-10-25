# Fashion Fussion CRM Panel — Agent Handoff

This folder is a focused entry point for AI agents working on the CRM panel in this repository. The production CRM implementation currently belongs to the existing admin-panel area; do not create a second competing CRM implementation unless the repository owner explicitly asks for a migration.

## Project
- Repository: https://github.com/praveens6050-afk/Fashion_Fussion
- Live CRM: https://www.crm.fashionfussion.in
- Working branch for CRM development: `crm-development`
- Current handoff branch: `docs/crm-agent-context`

## Primary task
Diagnose and fix the CRM panel's stuck loading behavior and related browser/CI failures. The known failing workflow is:
https://github.com/praveens6050-afk/Fashion_Fussion/actions/runs/39975362335

The reported failure is a Playwright browser smoke timeout waiting for `#dashboard` after navigation. Confirm the latest workflow and inspect the current source before deciding on a fix; do not assume the historical diagnosis is still current.

## Files to inspect first
- `admin-panel/crm.html` — CRM shell, loading/access-denied/dashboard visibility.
- `admin-panel/crm-auth.js` — authentication/session readiness, timeout and authorization checks.
- `admin-panel/crm-login.html` — invitation-only login UI.
- `admin-panel/crm-login.js` — sign-in and authorization enforcement.
- `scripts/check_crm_panel_contract.js` — static contract/security assertions.
- `scripts/crm_browser_smoke.js` — browser smoke tests.
- Related Supabase migrations, RLS policies, and CRM module loader files referenced by those sources.

If any path differs on the current branch, locate the actual equivalent file and update this guide.

## Security requirements — do not weaken
1. Public signup/registration must remain disabled. CRM access is invitation-only.
2. Only an authorized administrator or an active CRM team member whose access is bound to their authenticated email may enter.
3. Keep the dashboard hidden until authentication and authorization have succeeded.
4. Unauthorized users must be denied and signed out where appropriate.
5. Preserve Supabase Row Level Security (RLS), least privilege, and server-side authorization. Never rely on UI hiding as the only security boundary.
6. Never put service-role keys, passwords, access tokens, API keys, or other secrets in source, logs, commits, screenshots, or this guide.
7. Customer and seller CRM views must remain read-only projections unless an existing explicitly authorized workflow says otherwise.

## Required workflow
1. Inspect current branch, recent commits, current workflow logs, and all relevant code before editing.
2. Reproduce the failure with the existing tests. Determine whether the cause is a test selector/timing issue, a real loading deadlock, Supabase readiness/session handling, route redirect, or module-loader error.
3. Make a minimal fix that addresses the demonstrated root cause. Avoid broad rewrites and unrelated UI changes.
4. Run the contract check, relevant unit/build checks, and browser smoke test at desktop and mobile sizes where available.
5. Verify that unauthenticated access stays blocked and the public login page has no signup affordance.
6. Review the diff for secrets, auth bypasses, weakened RLS, and unintended changes.
7. Report the root cause, files changed, commands and pass/fail results, commit SHA, and remaining blockers.

## Deployment
Do not publish or deploy to production as part of diagnosis or a code fix unless the repository owner separately authorizes deployment. A green static test alone is not proof that the live website is healthy.

## Current known context (verify before relying on it)
- Earlier checks reported no public signup form/button in `crm-login.html`.
- Earlier CI checks passed the CRM contract/source checks but failed in `scripts/crm_browser_smoke.js` while waiting for `#dashboard`.
- The CRM page was expected to keep `#dashboard` hidden with `data-admin-ready="false"` before successful authorization.
- The exact present-day state must be rechecked against the current branch and latest CI run before changing code.

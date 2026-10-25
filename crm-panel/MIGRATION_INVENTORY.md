# CRM module migration inventory

This inventory is used to migrate the existing CRM without changing live panel routes prematurely.

## Browser entry points
- `crm.html` — CRM workspace shell.
- `crm-login.html` — invitation-only login.
- `crm-auth.js` — session, profile and CRM team authorization; fail-closed dashboard reveal.
- `crm-login.js` — login flow and CRM role verification.
- `crm-navigation.js` — in-page workspace navigation.

## CRM browser modules in this directory
- `crm-department-workspaces.js`
- `crm-sales-workspace.js`
- `crm-support-workspace.js`
- `crm-team-management.js`
- `crm-unified-inbox.js`
- `admin-crm.js`
- `admin-crm-followups.js`
- `admin-crm-directory.js`
- `admin-crm-notifications.js`
- `admin-crm-whatsapp-inbox.js`

## Runtime assets
- `supabase-config.js`, `csp-admin.css`, `csp-login.css`, `csp-dynamic.css`, and the CRM stylesheets were copied from their existing admin-panel locations.
- The HTML files in this directory are unchanged copies of the original pages. They still reference sibling assets by relative URL. The authorization loader dynamically loads workspace scripts by relative URL as well. This means the directory is not yet a safe standalone production route until every referenced asset is present and the browser/API routes are verified.

## Integration boundary — do not move blindly
These integrations remain canonical in their existing locations and are intentionally not duplicated into browser code:
- `admin-panel/functions/api/admin-crm-notifications.js`
- `admin-panel/functions/api/admin-crm-whatsapp-inbox.js`
- `admin-panel/functions/api/outreach/crm-email-reply-dispatch.js`
- `admin-panel/functions/api/outreach/crm-whatsapp-reply-dispatch.js`
- `supabase/functions/crm-inbound-webhook/index.ts`
- `supabase/functions/crm-send-reply/index.ts`
- CRM, email and WhatsApp database migrations under `supabase/migrations/`
- Shared customer, seller and admin schemas, auth/RLS, and panel integrations.

## Validation gates before production routing
1. Resolve and test all local script/style URLs from both CRM pages.
2. Confirm API URLs and deployment routing for email and WhatsApp remain unchanged.
3. Run `scripts/check_crm_panel_contract.js`, `scripts/check_whatsapp_crm_inbox_contract.js`, `admin-panel/tests/crm-reply-dispatch.test.mjs`, and `scripts/crm_browser_smoke.js`.
4. Run customer/seller/admin panel regression checks and verify invitation-only access, role checks, RLS and no public CRM signup.
5. Verify GitHub Actions and live browser behavior before any production switch.

No production deployment or remote database migration is performed by this branch.

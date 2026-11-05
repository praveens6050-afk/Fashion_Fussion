# CRM Panel Module (migration phase 1)

This folder is the start of the dedicated CRM panel module. The browser-facing CRM pages and their direct JavaScript/CSS dependencies are copied here from `admin-panel/` with the same blob content so the original live routes remain untouched during migration.

## Entry points
- `crm-login.html`: invitation-only sign-in; no public registration.
- `crm.html`: CRM workspace; dashboard stays hidden until access verification succeeds.
- `crm-auth.js` / `crm-login.js`: existing Supabase session, admin/team allowlist and role checks.
- `crm-unified-inbox.js`, `admin-crm-whatsapp-inbox.js`: inbox UI clients.
- `crm-sales-workspace.js`, `crm-support-workspace.js`, `crm-team-management.js`: CRM workspaces.
- `supabase-config.js`: existing public Supabase client configuration (no server secrets belong in browser files).

## Integrations intentionally kept in their existing locations
The following are shared/server-side dependencies and are not relocated in this phase:
- `admin-panel/functions/api/admin-crm-notifications.js`
- `admin-panel/functions/api/admin-crm-whatsapp-inbox.js`
- `admin-panel/functions/api/outreach/crm-email-reply-dispatch.js`
- `admin-panel/functions/api/outreach/crm-whatsapp-reply-dispatch.js`
- `supabase/functions/crm-inbound-webhook/` and `supabase/functions/crm-send-reply/`
- `supabase/migrations/*crm*` and related WhatsApp/email migrations
- Existing admin, seller and customer panel routes and their shared data/API contracts.

## Safety note
This is a non-destructive migration phase: original `admin-panel/` files are not deleted or rewritten. Before routing production traffic to these copies, run the CRM contract tests, WhatsApp contract tests, browser smoke tests, and panel regression suite. Server functions and migrations must remain deployed/configured as they are; no secrets, webhook keys, or provider credentials should be copied into this folder.

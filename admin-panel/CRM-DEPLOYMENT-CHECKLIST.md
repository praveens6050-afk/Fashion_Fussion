# CRM deployment readiness checklist

This checklist is for the isolated Seller Acquisition CRM in this PR. Keep this PR in Draft until every applicable gate below is checked by an authorized operator.

## Current code validation
- [x] CRM source syntax and contract checks pass in GitHub Actions.
- [x] Chromium smoke checks pass for desktop and 390px mobile: entry redirect, sign-in controls, fail-closed dashboard, and horizontal overflow.
- [x] All repository Supabase migrations replay from a clean disposable local database; schema lint and DB contract tests pass.
- [x] Cloudflare-only repository audit passes.
- [ ] Authenticated CRM E2E with a real authorized admin account has passed.
- [ ] Actual Cloudflare Pages project, deployment URL, routing and environment bindings have been verified.

## Cloudflare Pages project setup (do not deploy until approved)
1. Create/use a dedicated development Pages project (intended name: `fashion-fussion-crm-dev`).
2. Set project root/build output directory to `admin-panel`; no build command is required for these static files and Pages Functions.
3. Confirm the Pages Functions route `/api/admin-crm-notifications` is built from `admin-panel/functions/api/admin-crm-notifications.js`.
4. Configure environment variables in the development environment:
   - `SUPABASE_URL`: the explicitly approved development Supabase project URL.
   - `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`): that same project's publishable/anon key.
   - `ALLOWED_ORIGIN`: exact CRM Pages origin, no trailing slash; include only the deployed development hostname.
5. Confirm the Supabase project in `admin-panel/supabase-config.js` is the intended development project before any authenticated test. Do not assume the current project is non-production.
6. Add a custom hostname only after the development deployment is approved. Do not alter production DNS as part of this PR.

## Database rollout gate
- Migration `20261017110000_admin_seller_lead_crm.sql` adds CRM follow-up tasks and activity records.
- Migration `20261017120000_admin_crm_notification_snapshot.sql` adds the admin-only notification snapshot RPC.
- Local clean replay passing is not evidence that these migrations have been applied to a remote database.
- Before any remote migration, verify the target project/ref and current migration history, take/verify a recovery backup, review SQL and RLS, then obtain explicit approval. Never apply these migrations to production by default.

## Post-deployment verification (development only)
1. Verify unauthenticated access redirects to sign-in and dashboard remains hidden.
2. Verify a normal non-admin account is denied; verify a designated admin can sign in and sign out.
3. Exercise lead search/filter/create/edit and CSV import/export using disposable test records.
4. Verify follow-up task create/complete and activity timeline.
5. Verify customer/order directory is read-only and bounded.
6. Verify notification diagnostics show sanitized status only; do not send/retry any message.
7. Check browser console/network, mobile width, Pages Function CORS, and server logs for errors.
8. Remove test data and record the exact deployed commit and environment.

## Explicitly out of scope without separate approval
- Merging this Draft PR or deploying to production.
- Applying remote/production Supabase migrations or writing to live customer/order/payment data.
- Enabling cron/scheduler, sending email/WhatsApp, or triggering payment recovery.
- Changing production DNS or secrets.

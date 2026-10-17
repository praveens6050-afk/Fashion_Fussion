# CRM deployment readiness checklist

This checklist tracks the Seller Acquisition CRM in PR #334. Keep the PR in Draft until all release gates below are verified.

## Latest verified source checks — commit `5ffee3131a11db99eea2769f79795fdc57639fec`
- [x] Quality Gate passed: https://github.com/praveens6050-afk/Fashion_Fussion/actions/runs/39039739062
- [x] Cloudflare-only repository audit passed: https://github.com/praveens6050-afk/Fashion_Fussion/actions/runs/39039739067
- [x] Clean disposable Supabase migration replay passed: https://github.com/praveens6050-afk/Fashion_Fussion/actions/runs/39039739283
- [x] CRM JavaScript syntax/contract checks and unauthenticated browser smoke checks passed in CI.
- [x] Reproducible `npm run build --prefix admin-panel` creates `admin-panel/dist`; Pages Function stays at project root `admin-panel/functions/`.
- [ ] Authenticated CRM E2E using a real authorized admin account.
- [ ] Cloudflare project, exact deployment URL, Pages Functions routing, environment bindings, and origin verified.
- [ ] CRM migrations applied to an explicitly approved non-production database and end-to-end CRUD/follow-up/notification-snapshot tests passed.

## Cloudflare account/project verification — BLOCKER
The documented configuration is Cloudflare Pages project `fashion-fussion-admin`, production branch `cloudflare-admin`, root `admin-panel`, build command `npm run build`, output directory `dist`, hostname `admin.fashionfussion.in`. These are repository-documented values, not independently verified live Cloudflare settings. The CRM PR branch is `crm-development`.

No Cloudflare account/project read access was available during this audit. Do not assume a separate development Pages project exists or that the established Admin project deploys this branch. Before deployment, an authorized operator must verify the target project and select a safe deployment route. With project root `admin-panel`, use build command `npm run build` and output directory `dist`; keep Pages Functions at `admin-panel/functions/` (the project-root Functions directory), not inside `dist`.

## Required environment bindings
Configure only in the explicitly chosen development Pages environment:
- `SUPABASE_URL`: approved development Supabase URL.
- `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`): key for that same project.
- `ALLOWED_ORIGIN`: exact deployed development origin, without a trailing slash.
- Verify `admin-panel/supabase-config.js` points to that same approved development project. The currently configured project must not be presumed non-production.
- Verify Pages Function route `/api/admin-crm-notifications`, sourced from `admin-panel/functions/api/admin-crm-notifications.js`.

## Remote database status — BLOCKER
Read-only inspection of Supabase project `gmdevprqtvoshbbytsxf` found that `public.seller_lead_tasks`, `public.seller_lead_activities`, `public.admin_crm_notification_snapshot()`, and the CRM phone column are absent. The remote migration history currently ends at `20261017122330`; CRM migrations `20261017110000_admin_seller_lead_crm.sql` and `20261017120000_admin_crm_notification_snapshot.sql` are not recorded there. The project environment (development vs production) has not been established. Therefore CRM follow-up and notification-snapshot functionality is not remotely ready, even though isolated local migration replay passes.

Before applying remote migrations, verify the project environment/ref, confirm a recoverable backup, review SQL/RLS, and obtain explicit approval. Never apply to a possibly production database by default.

## Post-deployment verification (development only)
1. Unauthenticated access redirects to sign-in; dashboard remains hidden.
2. A non-admin account is denied; a designated admin can sign in/out.
3. Test lead search/filter/create/edit and CSV import/export with disposable records.
4. Test follow-up task creation/completion and activity timeline.
5. Confirm customer/order directory is read-only and bounded.
6. Confirm notification diagnostics return sanitized status only; do not send/retry messages.
7. Check browser console/network, mobile layout, CORS, and Pages Function logs.
8. Remove disposable test data and record deployed commit/environment.

## Explicitly out of scope without separate approval
- Merging this Draft PR or deploying to production.
- Applying remote/production Supabase migrations or writing to live customer/order/payment data.
- Enabling cron/scheduler, sending email/WhatsApp, or triggering payment recovery.
- Changing production DNS or secrets.

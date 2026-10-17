# CRM deployment readiness checklist

This checklist tracks the Seller Acquisition CRM in PR #334. Keep the PR in Draft until the open release gates below are verified.

## Verified on CRM code commit `de8f64460c7a0aaa561beb2f399f70e6f6969c8d` (CI still running for final browser/migration jobs)
- [x] CRM source syntax and contract checks pass in GitHub Actions.
- [x] Chromium checks pass at desktop and 390px mobile: entry redirect, login controls, fail-closed dashboard, and horizontal overflow.
- [x] All repository migrations replay from a clean disposable local Supabase database; schema lint and DB contract tests pass.
- [x] Cloudflare-only repository audit passes on `8cacdbd880d6dc07fc3f79a2cd80dcd40505b09e`.
- [x] Latest Quality Gate passes on `8cacdbd880d6dc07fc3f79a2cd80dcd40505b09e` (including browser smoke and syntax/contract checks).
- [x] Latest clean disposable Supabase migration replay, schema lint, and DB contract tests pass on `8cacdbd880d6dc07fc3f79a2cd80dcd40505b09e`.
- [x] Added `admin-panel/package.json` and reproducible `npm run build` script; Cloudflare Pages build output and root Functions location pass in Quality Gate run `39039707125`.
- [ ] Authenticated CRM E2E using a real authorized admin account.
- [ ] Cloudflare project, exact deployment URL, Pages Functions routing, environment bindings, and origin verified.

## Cloudflare account/project verification — BLOCKER
The repository now contains a reproducible `npm run build` script that writes static assets to `admin-panel/dist`; the native Pages Function remains at `admin-panel/functions/` so Pages can discover it from the project root. CI checks these assumptions. The documented project is `fashion-fussion-admin`, production branch `cloudflare-admin`, root `admin-panel`, output `dist`, hostname `admin.fashionfussion.in`. The CRM PR branch remains `crm-development`.

No Cloudflare account/project read access is available in this repository audit. Do not assume a separate `fashion-fussion-crm-dev` project exists or that the established Admin project deploys this branch. Before deployment, an authorized operator must choose and verify one route:
1. **Isolated development Pages project (preferred for safe validation):** confirm/create the project in Cloudflare, set the project root to `admin-panel`, and configure a static Pages deployment consistent with this repository (no build command unless a real build script is added; output directory must include the static files and `functions/`). Verify Pages Functions are included; or
2. **Integrate into established Admin project:** plan the merge/deployment through the documented `cloudflare-admin` release path only after review and approval.

No Cloudflare account/project read access is available in this repository audit, so actual project existence, settings, deployment URL, environment bindings, and DNS cannot be marked verified here. The build-script conflict is resolved in source, but actual Cloudflare settings still require verification.

## Required development environment bindings
Set these only in the chosen development Pages environment:
- `SUPABASE_URL`: explicitly approved development Supabase URL.
- `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`): key for that same project.
- `ALLOWED_ORIGIN`: exact deployed development origin, no trailing slash.
- Confirm `admin-panel/supabase-config.js` points to that same approved development project before login tests. The currently configured project must not be presumed to be non-production.

Pages Function route to verify: `/api/admin-crm-notifications`, sourced from `admin-panel/functions/api/admin-crm-notifications.js`.

## Database rollout gate
- `20261017110000_admin_seller_lead_crm.sql` adds CRM follow-up tasks and activity records.
- `20261017120000_admin_crm_notification_snapshot.sql` adds the admin-only notification snapshot RPC.
- Clean local replay passing does **not** prove that either migration has been applied to a remote database.
- Before a remote migration: verify project ref and migration history, verify a recoverable backup, review SQL/RLS, and obtain explicit approval. Never apply to production by default.

## Post-deployment verification (development only)
1. Unauthenticated access redirects to sign-in; dashboard remains hidden.
2. Non-admin account is denied; designated admin can sign in/out.
3. Test lead search/filter/create/edit and CSV import/export using disposable records.
4. Test follow-up task create/complete and activity timeline.
5. Confirm customer/order directory is read-only and bounded.
6. Confirm notification diagnostics return sanitized status only; do not send/retry messages.
7. Check browser console/network, mobile layout, CORS and Pages Function logs.
8. Remove disposable test data and record deployed commit/environment.

## Explicitly out of scope without separate approval
- Merging this Draft PR or deploying to production.
- Applying remote/production Supabase migrations or writing to live customer/order/payment data.
- Enabling cron/scheduler, sending email/WhatsApp, or triggering payment recovery.
- Changing production DNS or secrets.

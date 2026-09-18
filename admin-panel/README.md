# Fashion_Fussion Admin Panel — Standalone Deployment

This folder is intentionally isolated from the customer storefront and seller panel.

## Target URL

- Admin: `https://admin.fashionfussion.in`
- Customer: `https://fashionfussion.in`
- Seller: `https://seller.fashionfussion.in`

## Vercel project settings

Create a separate Vercel project from the same GitHub repository with:

- Project name: `fashion-fussion-admin`
- Production branch: `admin-panel-standalone`
- Root Directory: `admin-panel`
- Framework preset: Other / Static
- Custom domain: `admin.fashionfussion.in`

Do not attach `fashionfussion.in` or `seller.fashionfussion.in` to this project.

## Vercel environment variables

The browser uses the public Supabase URL/anon key from `supabase-config.js`. Keep all privileged values server-only.

Core admin server variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGIN=https://admin.fashionfussion.in`

Razorpay-backed admin readiness/refund operations also require the same production values used by the current customer backend:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

Shiprocket admin shipping/serviceability operations require:

- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_PICKUP_LOCATION`
- `SHIPROCKET_PICKUP_PINCODE`

Copy these through Vercel Environment Variables. Never commit their values to GitHub or browser JavaScript.

For preview verification, if the Vercel preview hostname sends an `Origin` header to the same-project API, add that exact preview origin to `ALLOWED_ORIGIN` as a comma-separated second value. After custom-domain verification, keep only origins that should actually be allowed.

## Supabase Auth redirect allowlist

For administrator password recovery, add this redirect URL in Supabase Auth URL configuration:

- `https://admin.fashionfussion.in/reset-password.html`

If password reset is tested on a Vercel preview URL, temporarily allow the exact preview reset-password URL too.

## Routing

- `/` and `/login` -> administrator sign-in
- `/admin` -> dashboard
- `/account` -> admin account
- `/reset-password` -> password recovery

The dashboard still verifies `profiles.is_admin = true` before showing administrator data. The admin-specific login additionally signs out authenticated non-admin users.

## Admin feature parity

The isolated package preserves the current dynamic Admin modules loaded by `supabase-config.js`, including:

- notifications and support chat
- order management and COD actions
- promotions
- returns/exchanges and approved return refunds
- business quote management
- inventory controls and catalog safety
- Shiprocket shipping and shipping health
- checkout health and launch readiness
- payment review, recovery status and attention UI

The required admin API/server files are bundled inside this project so the Admin frontend does not depend on relative files from the customer Vercel project.

## Backend boundary

Both customer and admin projects may intentionally use the same Supabase database because frontend deployment separation is distinct from data authorization. Access remains controlled by Supabase Auth, RLS, `profiles.is_admin`, and the server-side administrator checks.

## Store preview

Admin `Store Preview` opens the normal customer storefront at `https://fashionfussion.in/`.

Supabase browser sessions are origin-specific, so an administrator signed in at `admin.fashionfussion.in` is not automatically signed in at `fashionfussion.in`. The old `?admin_preview=1` cross-domain behavior is intentionally not used. If inactive-product preview is needed later, use a short-lived server-issued preview-token flow rather than sharing browser auth across domains.

## Safe rollout order

1. Deploy this project on its Vercel-generated preview URL.
2. Add all required server environment variables.
3. Verify admin login and role rejection for a non-admin account.
4. Verify product list/private costs/add/edit/inactivate flows.
5. Verify orders, promotions, returns, quotes, inventory, payment review and shipping/readiness panels.
6. Verify admin account and password-reset flow.
7. Attach `admin.fashionfussion.in` only after preview verification.
8. Keep the current customer project/domain unchanged during this process.
9. Only after the admin subdomain is healthy should the customer-only project redirect legacy admin URLs here.

This branch/folder must not be merged into `main` merely to deploy the admin project. Vercel should deploy it directly from `admin-panel-standalone` with Root Directory `admin-panel`.

## Verification checkpoint — 19 Sep 2026

This branch is the deployment candidate after standalone cleanup. The existing live customer production remains on `main`; this checkpoint exists to trigger and identify the exact Admin preview build without changing production aliases or domains.

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

The dashboard verifies `profiles.is_admin = true` before showing administrator data. The admin-specific login additionally signs out authenticated non-admin users.

## Seller Product Approvals

The Admin dashboard now includes a connected **Seller Product Approvals** queue.

- Admin can see seller-owned submissions through the admin RLS path.
- Pending submissions can be approved or rejected.
- Rejection requires a non-empty seller-visible reason.
- The browser does not directly activate customer products; review actions call the authenticated `admin_review_seller_product(...)` database RPC.
- The RPC independently checks `profiles.is_admin = true` server-side.
- Approval prepares the authoritative customer product, variants/inventory and optional bulk tier before activation.
- Rejection keeps/deactivates the linked customer product so it remains hidden.
- A seller revision of an approved listing automatically deactivates the linked customer product until reapproval.

The Seller/Admin/Customer lifecycle has passed rollback-only database assertions, including denial of a non-admin approval attempt and customer/anonymous visibility checks.

## Admin feature parity

The isolated package preserves the current dynamic Admin modules loaded by `supabase-config.js`, including:

- Seller Product Approvals
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

Customer, Admin and Seller projects intentionally use the same Supabase database while remaining separate frontend deployments. Access is controlled by Supabase Auth, RLS, `profiles.is_admin`, seller ownership policies and server/database authorization checks.

## Store preview

Admin `Store Preview` opens the normal customer storefront at `https://fashionfussion.in/`.

Supabase browser sessions are origin-specific, so an administrator signed in at `admin.fashionfussion.in` is not automatically signed in at `fashionfussion.in`. The old `?admin_preview=1` cross-domain behavior is intentionally not used. If inactive-product preview is needed later, use a short-lived server-issued preview-token flow rather than sharing browser auth across domains.

## Safe rollout order

1. Deploy this project on its Vercel-generated preview URL.
2. Add all required server environment variables.
3. Verify admin login and role rejection for a non-admin account.
4. Submit a controlled seller listing from the Seller preview and verify it appears in Seller Product Approvals.
5. Reject it and verify the reason reaches the Seller while Customer cannot see it.
6. Resubmit and approve it; verify product/variant/inventory creation and Customer visibility.
7. Verify product list/private costs/add/edit/inactivate flows.
8. Verify orders, promotions, returns, quotes, inventory, payment review and shipping/readiness panels.
9. Verify admin account and password-reset flow.
10. Attach `admin.fashionfussion.in` only after preview verification.
11. Keep the current customer project/domain unchanged during this process.

This branch/folder must not be merged into `main` merely to deploy the Admin project. Vercel should deploy it directly from `admin-panel-standalone` with Root Directory `admin-panel`.

## Verification checkpoint — 19 Sep 2026

The database approval workflow is connected and rollback-tested. Exact browser smoke testing of this final branch SHA remains a Vercel deployment-time gate after quota reset. Existing live customer production remains on `main` until all three standalone projects pass their preview checks.

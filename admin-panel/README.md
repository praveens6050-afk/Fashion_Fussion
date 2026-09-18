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

## Required Vercel environment variables

The browser uses the public Supabase URL/anon key from `supabase-config.js`. Server-only API functions require:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGIN=https://admin.fashionfussion.in`

`SUPABASE_SERVICE_ROLE_KEY` must remain server-only and must never be placed in browser JavaScript.

For preview verification, if the Vercel preview hostname sends an `Origin` header to the same-project API, add that exact preview origin to `ALLOWED_ORIGIN` as a comma-separated second value. After custom-domain verification, keep only origins that should actually be allowed.

## Routing

- `/` and `/login` -> administrator sign-in
- `/admin` -> dashboard
- `/account` -> admin account
- `/reset-password` -> password recovery

The dashboard still verifies `profiles.is_admin = true` before showing administrator data. The admin-specific login additionally signs out authenticated non-admin users.

## Backend boundary

The admin project contains its own copy of the currently required admin API entry point and server modules. This prevents an admin frontend deployment from depending on customer-project static files or relative customer routes.

Both projects may intentionally use the same Supabase database because customer/admin separation is a deployment boundary, while authorization remains enforced through Supabase Auth, RLS and the existing admin server checks.

## Store preview

Admin `Store Preview` opens the normal customer storefront at `https://fashionfussion.in/`.

Supabase browser sessions are origin-specific, so an administrator signed in at `admin.fashionfussion.in` is not automatically signed in at `fashionfussion.in`. The old `?admin_preview=1` cross-domain behavior is therefore intentionally not used here. If inactive-product preview is needed later, add a short-lived server-issued preview-token flow rather than sharing browser auth across domains.

## Safe rollout order

1. Deploy this project on its Vercel-generated preview URL.
2. Add the required server environment variables.
3. Verify admin login, product list, private costs, add/edit/inactivate flows and admin account.
4. Attach `admin.fashionfussion.in` only after preview verification.
5. Keep the current customer project/domain unchanged during this process.
6. Only after the admin subdomain is confirmed healthy should customer-only routing be tightened to stop exposing legacy admin pages on the customer project.

This branch/folder must not be merged into `main` merely to deploy the admin project. Vercel should deploy it directly from `admin-panel-standalone` with Root Directory `admin-panel`.

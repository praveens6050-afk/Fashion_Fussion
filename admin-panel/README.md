# Fashion_Fussion Admin Panel — Cloudflare Deployment

This folder is the dedicated Cloudflare Pages package for `admin.fashionfussion.in`. It is intentionally isolated from the Customer storefront and Seller Center while sharing the same Supabase backend.

## Cloudflare project settings

- Pages project: `fashion-fussion-admin`
- Production branch: `cloudflare-admin`
- Root Directory: `admin-panel`
- Build command: `npm run build`
- Build output directory: `dist`
- Custom domain: `admin.fashionfussion.in`

Do not attach the customer or seller domains to this project.

## Environment variables

The browser uses the public Supabase URL/publishable key from the frontend configuration. Privileged values remain server-side in Cloudflare Pages environment variables/secrets.

Core Admin server variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGIN=https://admin.fashionfussion.in`

Razorpay-backed readiness/refund operations require:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

Shiprocket operations require:

- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_PICKUP_LOCATION`
- `SHIPROCKET_PICKUP_PINCODE`

Never commit secret values to GitHub or browser JavaScript.

## Supabase Auth redirect allowlist

Allow the production password recovery callback:

- `https://admin.fashionfussion.in/reset-password`

Use temporary Cloudflare preview callback URLs only during controlled preview testing and remove them when no longer needed.

## Routing and security boundary

- `/` redirects to `/login`
- `/login` is a static Cloudflare Pages asset with strict response security headers
- `/admin` is the authenticated dashboard
- `/admin-account` is the administrator account page
- `/reset-password` is password recovery
- `/api/*` is the Cloudflare Pages Functions boundary

The dashboard verifies `profiles.is_admin = true` before exposing administrator data. Login uses server-side rate limiting and signs out authenticated non-admin users.

## Seller Product Approvals

The Admin dashboard includes the connected Seller Product Approvals queue.

- Admin can see seller-owned submissions through the admin RLS path.
- Pending submissions can be approved or rejected.
- Rejection requires a non-empty seller-visible reason.
- Review actions call the authenticated `admin_review_seller_product(...)` database RPC.
- The RPC independently checks `profiles.is_admin = true` server-side.
- Approval prepares the authoritative customer product, variants/inventory and optional bulk tier before activation.
- Rejection keeps/deactivates the linked customer product.
- A seller revision of an approved listing deactivates the linked customer product until reapproval.

## Admin feature boundary

The package includes Admin modules for seller approvals, notifications/support, order management, promotions, returns/refunds, business quotes, inventory/catalog safety, shipping, checkout health, launch readiness, payment review and recovery status.

Customer, Admin and Seller deployments use the same Supabase database while remaining separate frontend origins. Access is controlled by Supabase Auth, RLS, `profiles.is_admin`, seller ownership policies and server/database authorization checks.

## Store preview

Admin Store Preview opens `https://fashionfussion.in/`. Browser sessions are origin-specific; Admin authentication is not shared with the Customer storefront.

## Production verification

Before production changes are considered complete:

1. Run the branch Cloudflare validation workflow.
2. Verify the exact Cloudflare Admin deployment succeeds.
3. Test administrator login and non-admin rejection.
4. Verify Seller approval/rejection lifecycle.
5. Verify product, order, promotions, returns, quotes, inventory and shipping operations.
6. Verify Admin account and password recovery flows.
7. Run accessibility/security/performance tests against `https://admin.fashionfussion.in`.

This branch is Cloudflare-only. Legacy hosting configuration and unrelated Customer/Seller deployment files must not be added to it.

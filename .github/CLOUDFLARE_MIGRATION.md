# Fashion_Fussion — Vercel to Cloudflare migration

## Goal
Move the complete Fashion_Fussion production stack from Vercel to Cloudflare with no functional regression and with Vercel kept as rollback until Cloudflare is verified.

## Cloudflare projects

| Panel | Cloudflare project | Git branch | Root directory | Build command | Output |
|---|---|---|---|---|---|
| Customer | `fashion-fussion-customer` | `cloudflare-customer` | `customer-panel` | `npm run build` | `dist` |
| Admin | `fashion-fussion-admin` | `cloudflare-admin` | `admin-panel` | `npm run build` | `dist` |
| Seller | `fashion-fussion-seller` | `cloudflare-seller` | `seller-panel` | `npm run build` | `dist` |

Customer/Admin Functions are intentionally limited to `/api/*` via `_routes.json`; normal pages/assets remain static CDN traffic. Seller has no server-side API Functions.

## Runtime compatibility
`compatibility_date = 2026-09-22`. Existing Node-style backend handlers are bundled through Pages Functions compatibility adapters. Wrangler validation already passes for Customer, Admin and Seller.

## Customer runtime variables / secrets
Set for both Preview and Production where applicable:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- `RAZORPAY_KEY_ID` (secret)
- `RAZORPAY_KEY_SECRET` (secret)
- `RAZORPAY_WEBHOOK_SECRET` (secret)
- `ALLOWED_ORIGIN`

Production `ALLOWED_ORIGIN=https://fashionfussion.in`.
During preview testing add the exact Customer `*.pages.dev` origin as a comma-separated allowed origin.

## Admin runtime variables / secrets
- `SUPABASE_URL`
- `ALLOWED_ORIGIN`
- `RAZORPAY_KEY_ID` (secret)
- `RAZORPAY_KEY_SECRET` (secret)
- `RAZORPAY_WEBHOOK_SECRET` (secret)
- `SHIPROCKET_EMAIL` (secret)
- `SHIPROCKET_PASSWORD` (secret)
- `SHIPROCKET_PICKUP_LOCATION`
- `SHIPROCKET_PICKUP_PINCODE`

Normal Admin authorization uses the signed-in Admin JWT + Supabase RLS/RPC checks; a service-role key is not required for its normal runtime path.

Production `ALLOWED_ORIGIN=https://admin.fashionfussion.in`.
During preview testing add the exact Admin `*.pages.dev` origin.

## Seller runtime
Seller frontend talks directly to Supabase using the publishable key already present in frontend configuration. No server-side Cloudflare secret is required for normal Seller runtime.

## Supabase Auth preview allow-list
Before testing auth on `pages.dev`, add the exact preview origins/redirect URLs to Supabase Auth allowed redirects. Seller reset/signup uses `location.origin`, so the preview URL must be allow-listed. Do not remove existing production redirects until final cutover is complete.

## Pre-cutover verification
1. Customer: homepage, auth, search, product, cart, checkout, COD/prepaid, order confirmation, order status/tracking, cancel/refund status.
2. Seller: login/register/reset, catalog, normal image upload, submit/edit product, approval/rejection state.
3. Admin: login/reset, seller review, product/inventory, image upload, orders, refund actions, shipping/Shiprocket, checkout health.
4. Browser console must be clean of startup errors.
5. Security headers/CSP must match current production intent.
6. Razorpay webhook must be tested against the Cloudflare Customer API endpoint before production DNS cutover.

## Domain cutover order
1. Deploy and verify all three `pages.dev` previews.
2. Attach `seller.fashionfussion.in` and verify Seller.
3. Attach `admin.fashionfussion.in` and verify Admin.
4. Attach `fashionfussion.in` and `www` as required; verify Customer end-to-end.
5. Update Razorpay webhook target to Cloudflare-backed production endpoint and confirm signature processing.
6. Re-run Supabase Auth redirect checks on final custom domains.
7. Keep Vercel projects intact during the observation window.
8. Only after all production smoke tests pass, disconnect Vercel Git/domain mappings and remove obsolete Vercel deployment configuration.

## Rollback
If a critical issue appears after DNS cutover, restore the previous Vercel DNS/project mapping while Cloudflare is repaired. Do not delete Vercel projects or environment variables before successful Cloudflare production validation.

## ChatGPT / Cloudflare connector target
Preferred connector: Cloudflare official remote MCP endpoint `https://mcp.cloudflare.com/mcp` using OAuth. Once connected with write-capable permissions, use it for project creation, Pages/Workers configuration, variables/secrets, DNS/custom-domain cutover and deployment inspection.

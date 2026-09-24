# Fashion_Fussion — Cloudflare production architecture

Fashion_Fussion production is deployed on Cloudflare Pages with three isolated projects.

| Panel | Cloudflare project | Git branch | Root directory | Build command | Output |
|---|---|---|---|---|---|
| Customer | `fashion-fussion-customer` | `cloudflare-customer` | `customer-panel` | `npm run build` | `dist` |
| Admin | `fashion-fussion-admin` | `cloudflare-admin` | `admin-panel` | `npm run build` | `dist` |
| Seller | `fashion-fussion-seller` | `cloudflare-seller` | `seller-panel` | `npm run build` | `dist` |

Customer and Admin Pages Functions are intentionally limited to `/api/*` through `_routes.json`; normal pages and assets remain static CDN traffic. Seller has no server-side Pages Functions requirement for its normal runtime.

## Customer runtime variables / secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- `RAZORPAY_KEY_ID` (secret)
- `RAZORPAY_KEY_SECRET` (secret)
- `RAZORPAY_WEBHOOK_SECRET` (secret)
- `ALLOWED_ORIGIN=https://fashionfussion.in`

For controlled preview testing, add the exact Customer `pages.dev` origin only for the duration of the test.

## Admin runtime variables / secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` where required by server-only controls
- `ALLOWED_ORIGIN=https://admin.fashionfussion.in`
- `RAZORPAY_KEY_ID` (secret)
- `RAZORPAY_KEY_SECRET` (secret)
- `RAZORPAY_WEBHOOK_SECRET` (secret)
- `SHIPROCKET_EMAIL` (secret)
- `SHIPROCKET_PASSWORD` (secret)
- `SHIPROCKET_PICKUP_LOCATION`
- `SHIPROCKET_PICKUP_PINCODE`

## Seller runtime

Seller frontend talks directly to Supabase using the publishable frontend key. Seller ownership and mutations are protected by Auth, RLS and authenticated RPCs.

## Production verification

1. Customer: homepage, auth, search, product, cart, checkout, COD/prepaid payment, confirmation, tracking, cancellation and refund status.
2. Seller: login/register/reset, catalog, normal image upload, submit/edit product and approval/rejection state.
3. Admin: login/reset, seller review, product/inventory, image upload, orders, refund actions, shipping and checkout health.
4. Browser console should be free of application startup errors.
5. Security headers and CSP must be present on production responses.
6. Razorpay webhook signature processing must be verified against the Customer production API.
7. All three branch validation workflows and the matching Cloudflare deployment checks must pass for the exact production commit.

## Repository boundary

Each Cloudflare branch contains only its deployment package plus shared infrastructure required by that branch. Legacy hosting configuration, unrelated panel folders and obsolete deployment adapters are intentionally excluded.

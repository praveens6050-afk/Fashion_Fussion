# Fashion_Fussion Customer Store — Isolated Deployment

This branch is the customer/storefront deployment candidate. It starts from the current production `main` source so customer behavior stays unchanged while Admin and Seller move to dedicated subdomains.

## Final URL matrix

- Customer: `https://fashionfussion.in`
- Admin: `https://admin.fashionfussion.in`
- Seller: `https://seller.fashionfussion.in`

## Vercel customer project

Recommended separate project:

- Project name: `fashion-fussion-customer`
- Git repository: `praveens6050-afk/Fashion_Fussion`
- Production branch: `customer-panel-standalone`
- Root Directory: `customer-panel`
- Framework preset: Other / Static
- Custom domain after validation: `fashionfussion.in`

Do not attach `admin.fashionfussion.in` or `seller.fashionfussion.in` to the customer project.

## Customer-only deployment package

The `customer-panel/` folder is the dedicated customer storefront package. Admin frontend modules and admin-only backend actions are intentionally excluded.

Customer courier tracking uses a dedicated authenticated `/api/shipping-status` endpoint that only reads the signed-in customer's own shipment record. Shipment creation, AWB assignment, pickup scheduling, Shiprocket health checks, private product costs, checkout-health administration, admin order mutations and refund execution belong to the Admin project.

The customer `vercel.json` adds panel boundaries:

- `/admin` and `/admin.html` -> `https://admin.fashionfussion.in`
- `/admin-account` and `/admin-account.html` -> `https://admin.fashionfussion.in/account`
- `/seller` and `/seller-panel/*` -> `https://seller.fashionfussion.in`

Customer canonical headers, `robots.txt` and `sitemap.xml` use `https://fashionfussion.in`.

The repository-root `vercel.json` remains identical to `main`; the isolated customer project must use Root Directory `customer-panel`.

## Environment variables

Before testing a new customer Vercel project, copy only the variables required by customer checkout/payment/refund-status APIs. Do not copy secrets into GitHub files.

Required server variables include the existing Supabase and Razorpay variables used by the customer payment flows, plus `ALLOWED_ORIGIN=https://fashionfussion.in` for production. Add a controlled preview origin only while preview testing.

Shiprocket administrator credentials and pickup configuration are not required by the cleaned Customer project; those belong to the Admin project.

## Safe zero-downtime rollout

1. Leave the current live `fashion-fussion` Vercel project and `fashionfussion.in` domain unchanged.
2. Create `fashion-fussion-admin` and test its generated Vercel URL.
3. Create `fashion-fussion-seller` and test its generated Vercel URL.
4. Create `fashion-fussion-customer` from this branch with Root Directory `customer-panel`, then configure the required customer environment variables.
5. Run customer smoke tests on the generated preview URL: homepage, login, product, cart, checkout calculation, payment/COD paths that can be tested safely, account/orders, courier status, returns and business/bulk flows.
6. Attach `admin.fashionfussion.in` and `seller.fashionfussion.in` only after their previews pass.
7. Verify both subdomains independently.
8. Only then move `fashionfussion.in` from the old customer Vercel project to `fashion-fussion-customer`.
9. Immediately run production smoke tests on the custom domain.
10. Keep the old customer project/deployment available as rollback until the new customer project is confirmed stable.

Do not delete the old Vercel project during cutover.

## Authentication note

Supabase browser sessions are origin-specific. Customer, admin and seller frontends should not rely on sharing browser local/session storage across the three subdomains. Each application must authenticate/authorize for its own role and origin.

The dedicated Admin project enforces `profiles.is_admin = true`. Seller production authentication still needs its Supabase seller-role/ownership integration before replacing the current standalone seller prototype authentication.

## Rollback

If the new customer project has any production issue after domain cutover, reassign `fashionfussion.in` to the previously working Vercel customer project/deployment. Database migrations or destructive backend changes must not be bundled with this frontend domain split.

## Verification checkpoint — 19 Sep 2026

This branch is the exact cleaned Customer deployment candidate. The existing `fashionfussion.in` production remains on the current `main` deployment until a separate Customer Vercel project passes preview smoke tests; no production domain move is part of this checkpoint.

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

## Seller catalog integration

No special Seller code is required in the Customer frontend. The connected Seller/Admin workflow publishes approved seller listings into the existing authoritative customer commerce tables:

- `products`
- `product_variants`
- `inventory_levels`
- `product_bulk_tiers` when applicable

The existing product RLS remains the visibility boundary: anonymous/customer catalog reads only receive products with `products.is_active = true`.

Therefore:

- Pending seller submission → not customer-visible.
- Approved seller submission → authoritative product/variant/inventory is prepared and then activated → customer-visible.
- Edit of an approved seller submission → linked customer product is immediately deactivated while the revision is pending.
- Rejected seller submission → rejection reason stays in the seller/admin workflow and the linked customer product stays inactive/hidden.
- Reapproval updates/reactivates the linked product rather than creating a duplicate.

This behavior has been verified through rollback-only database assertions using the anonymous customer role.

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
5. Run customer smoke tests on the generated preview URL: homepage, login, approved seller product visibility, product/variant selection, cart, checkout calculation, payment/COD paths that can be tested safely, account/orders, courier status, returns and business/bulk flows.
6. Attach `admin.fashionfussion.in` and `seller.fashionfussion.in` only after their previews pass.
7. Verify Seller → Admin Approve/Reject → Customer visibility end to end on preview URLs.
8. Only then move `fashionfussion.in` from the old customer Vercel project to `fashion-fussion-customer`.
9. Immediately run production smoke tests on the custom domain.
10. Keep the old customer project/deployment available as rollback until the new customer project is confirmed stable.

Do not delete the old Vercel project during cutover.

## Authentication note

Supabase browser sessions are origin-specific. Customer, Admin and Seller frontends do not rely on sharing browser local/session storage across the three subdomains. Each application authenticates/authorizes for its own role and origin.

The dedicated Admin project enforces `profiles.is_admin = true`. Seller catalog authentication/ownership now uses Supabase Auth plus seller-owned submission rows and authenticated RPCs. Seller KYC, settlements, order fulfilment and other operational modules remain separate staged integrations.

## Rollback

If the new customer project has any production issue after domain cutover, reassign `fashionfussion.in` to the previously working Vercel customer project/deployment. Do not bundle destructive database changes with the frontend domain cutover.

## Verification checkpoint — 19 Sep 2026

This branch is the exact cleaned Customer deployment candidate. The existing `fashionfussion.in` production remains on the current `main` deployment until a separate Customer Vercel project passes preview smoke tests; no production domain move is part of this checkpoint.

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

The `customer-panel/` folder is a dedicated deployable copy of the current customer storefront. Admin HTML/JS/CSS modules are intentionally not included in this frontend package.

The customer package keeps the existing API/backend tree during the first split because customer checkout, payment, shipping/tracking and post-purchase flows currently share backend implementation with some authenticated admin actions. Those server routes remain authorization-protected. Backend service extraction should happen only after all three frontends are stable.

The customer `vercel.json` adds panel boundaries:

- `/admin` and `/admin.html` -> `https://admin.fashionfussion.in`
- `/admin-account` and `/admin-account.html` -> `https://admin.fashionfussion.in/account`
- `/seller` and `/seller-panel/*` -> `https://seller.fashionfussion.in`

Customer canonical headers, `robots.txt` and `sitemap.xml` use `https://fashionfussion.in`.

The repository-root `vercel.json` remains identical to `main`; the isolated customer project must use Root Directory `customer-panel`.

## Environment variables

Before testing a new customer Vercel project, copy the existing production project's required environment variables through Vercel's environment-variable UI. Do not copy secrets into GitHub files.

Preserve all environment variables used by the existing checkout, Razorpay, Supabase and shipping server functions. The new customer project must be functionally equivalent to the existing customer project before domain cutover.

If `ALLOWED_ORIGIN` is configured, include the exact customer production origin `https://fashionfussion.in` and any preview origin used during controlled preview testing.

## Safe zero-downtime rollout

1. Leave the current live `fashion-fussion` Vercel project and `fashionfussion.in` domain unchanged.
2. Create `fashion-fussion-admin` and test its generated Vercel URL.
3. Create `fashion-fussion-seller` and test its generated Vercel URL.
4. Create `fashion-fussion-customer` from this branch with Root Directory `customer-panel`, then copy the current customer project's environment variables.
5. Run customer smoke tests on the generated preview URL: homepage, login, product, cart, checkout calculation, payment/COD paths that can be tested safely, account/orders, returns and business/bulk flows.
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

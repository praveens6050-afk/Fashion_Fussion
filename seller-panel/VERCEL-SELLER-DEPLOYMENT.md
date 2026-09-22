# Seller Panel — Separate Vercel Project

Use this configuration only for the dedicated seller portal. Do not reuse the existing customer `fashion-fussion` Vercel project.

## Target

- Vercel project name: `fashion-fussion-seller`
- Git repository: `praveens6050-afk/Fashion_Fussion`
- Production branch: `seller-panel-standalone`
- Root Directory: `seller-panel`
- Framework Preset: Other / static
- Build Command: none
- Install Command: none
- Output Directory: project root / default static output
- Custom domain target: `seller.fashionfussion.in`

## Connected production catalog workflow

The seller catalog is now connected to the existing Fashion_Fussion Supabase project.

- Seller authentication uses Supabase Auth.
- An authenticated seller owns a `seller_profiles` row.
- Product submissions are stored in `seller_product_submissions` and start as `pending`.
- Sellers cannot directly set approval status or activate customer products.
- The Admin portal reviews pending seller submissions.
- Admin approval publishes/updates the authoritative customer `products` record plus variants, inventory and optional bulk tier, then activates it.
- Editing an approved listing immediately deactivates the linked customer product and returns the submission to `pending` until it is reviewed again.
- Admin rejection requires a seller-visible reason and keeps/deactivates the linked customer product so it is not customer-visible.
- Customer catalog visibility continues to use the existing `products.is_active = true` RLS policy.

Seller table writes are performed through authenticated RPCs with ownership/admin checks. Browser clients use only the Supabase publishable key; no service-role key belongs in this project.

## What is still preview-only

Catalog authentication, ownership, submission, admin review and customer visibility are connected. Other Seller Center workspaces such as orders, payouts/settlements, returns operations, KYC verification, bank verification, courier booking and staff/RBAC still contain prototype/UI preparation and must not be treated as authoritative production operations until their backend phases are connected.

## Supabase Auth launch settings

Before public seller signup, configure Supabase Auth URL settings to allow the production Seller URL, including the clean login callback used by the portal:

- `https://seller.fashionfussion.in/login`

If the deployment resolves password/auth callbacks to `login.html`, allow that exact URL too. During preview smoke testing, temporarily allow only the exact controlled Vercel preview callback URL being tested.

Supabase Security Advisor currently reports Leaked Password Protection as disabled. Enable it in Auth password-security settings before opening seller registration publicly.

## Routing

`seller-panel/vercel.json` enables clean URLs and security headers.

Expected public entry:

- `https://seller.fashionfussion.in`

Unauthenticated dashboard access is redirected to seller sign-in. A valid Supabase seller session is required before catalog data is loaded.

## Domain attachment

Attach `seller.fashionfussion.in` only to the dedicated seller Vercel project. Follow the DNS record Vercel shows if the parent domain DNS is managed outside Vercel.

Do not move the customer production domain away from the existing `fashion-fussion` project while Seller is being verified.

## Verification after first deployment

1. Open the seller root URL in a private/incognito browser and confirm unauthenticated access reaches Seller Login.
2. Register a controlled seller test account and complete email verification if enabled.
3. Confirm the seller profile is created and the dashboard loads only that seller's submissions.
4. Submit a product and confirm it appears as Pending and is not visible on the customer storefront.
5. Sign into the dedicated Admin project and confirm the same submission appears in Seller Product Approvals.
6. Reject it with a reason and confirm the exact reason appears to the seller while the customer storefront still cannot see it.
7. Fix/resubmit the listing and approve it from Admin.
8. Confirm the authoritative product, variant/inventory and optional bulk tier are created/updated and the product appears in the customer storefront.
9. Edit the approved seller listing and confirm the customer product disappears while the revision is Pending.
10. Reapprove and confirm the same linked customer product becomes active again without a duplicate listing.
11. Sign out and confirm the seller session cannot access catalog data.
12. Confirm the current customer production project/domain remained unchanged during all preview tests.

## Verification checkpoint — 19 Sep 2026

The database workflow has been verified with rollback-only end-to-end assertions covering seller submission, non-admin approval denial, admin approval, customer/anon visibility, inventory creation, bulk tier publication, revision auto-hide, rejection reason persistence and rejected-product invisibility. Test records were rolled back and no integration-test rows remain.

Vercel browser smoke tests for the exact final standalone SHA remain a deployment-time gate after quota reset. Do not attach the seller production domain until those tests pass.

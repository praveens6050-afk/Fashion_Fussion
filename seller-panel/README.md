# Fashion_Fussion Seller Panel

This folder is the dedicated Cloudflare Pages Seller Center package for `seller.fashionfussion.in`. It is isolated from the Customer and Admin frontend deployments and uses the shared Fashion_Fussion Supabase backend.

## Connected now

### Seller authentication and ownership
- Supabase Auth seller sign-in and registration
- Authenticated seller profile in `seller_profiles`
- Seller catalog rows are owner-scoped by authenticated user ID
- Direct browser writes to protected seller tables are not granted; catalog mutations use authenticated RPC functions with ownership checks
- No service-role secret is exposed to Seller frontend code

### Catalog approval workflow
- Add and edit seller listings
- New or revised listings become `pending`
- Admin sees seller submissions in a dedicated Seller Product Approvals queue
- Admin **Approve** publishes/updates the authoritative customer product
- Admin **Reject** requires a reason that is shown back to the seller
- Rejected listings are not customer-visible
- Editing an already approved listing makes the linked customer product inactive while the revision is pending
- Reapproval reuses the linked customer product rather than creating a duplicate
- Approved listings publish variant/inventory data and optional bulk pricing into the existing customer commerce tables
- Listings without custom seller variants receive one authoritative default SKU/variant
- Customer visibility relies on the existing `products.is_active = true` RLS policy

### Listing data supported
- Product name, category and seller SKU
- Description, retail price, MRP and GST
- Brand, HSN and country of origin
- Product image URL and additional media metadata
- Optional B2B/bulk MOQ and unit price
- Size/color variant matrix with SKU, stock and optional price override
- Package dimensions, dispatch time, return window and low-stock threshold metadata

## Seller Center workspaces still in staged integration

The catalog approval path above is authoritative. Several other Seller Center modules remain UI/prototype preparation until their separate backend phases are connected:

- seller order fulfilment
- seller settlements/payouts
- return/refund execution
- courier booking/AWB actions
- KYC/PAN/GST/bank verification
- protected document upload
- seller support/helpdesk backend
- staff invitations and server-enforced RBAC
- some analytics/notification/demo operational datasets

Do not treat placeholder operational values in those workspaces as real marketplace transactions.

## Approval lifecycle

1. Seller authenticates with Supabase Auth.
2. Seller creates a listing → `pending`.
3. Customer storefront cannot see the pending submission.
4. Admin reviews it in **Seller Product Approvals**.
5. Approve → product + inventory/variants/bulk tier are prepared, then the authoritative `products` row is activated.
6. Existing customer RLS makes the active product visible to customer/anonymous catalog reads.
7. Reject → mandatory `rejection_reason` is stored and shown to the seller; linked product remains inactive.
8. Seller fixes and resubmits → `pending`, old rejection reason cleared.
9. A material edit to an approved listing deactivates the live product until it is approved again.

## Backend objects

Connected seller catalog objects include:

- `seller_profiles`
- `seller_product_submissions`
- `register_seller_profile(...)`
- `submit_seller_product(...)`
- `admin_review_seller_product(...)`
- `withdraw_seller_product(...)`

Existing customer commerce objects reused on approval include:

- `products`
- `product_variants`
- `inventory_levels`
- `product_bulk_tiers`

RLS and table privileges keep seller submission rows seller-owned/admin-readable. Approval authority is checked server-side against `profiles.is_admin = true`.

## Cloudflare production prerequisites

1. Cloudflare Pages project: `fashion-fussion-seller`.
2. Production branch: `cloudflare-seller`.
3. Root Directory: `seller-panel`.
4. Build command: `npm run build`.
5. Build output: `dist`.
6. Add `https://seller.fashionfussion.in/login` to Supabase Auth redirect URLs.
7. Keep Supabase password/security protections enabled and run browser smoke tests before public registration changes.

## Main files

- `login.html` — Supabase seller sign-in / registration UI
- `auth.js` — seller authentication + profile bootstrap
- `supabase-config.js` — publishable Supabase client setup and dashboard integration preload
- `index.html` — Seller Center dashboard shell
- `app.js` — base seller catalog UI renderer
- `portal.js` — seller workspace/module bootstrap
- `seller-live-integration.js` — authoritative seller catalog/RPC adapter
- `catalog-enhancements.js` — advanced listing/variant/bulk/media fields
- `inventory-fulfillment.js`, `analytics-shipping.js`, `returns-support-team.js`, and other modules — staged operations workspaces

## Deployment boundary

This branch is Cloudflare-only. Customer/Admin deployment artifacts and legacy hosting configuration must not be added here. The final host is `seller.fashionfussion.in`.

# Fashion_Fussion Seller Panel

This folder is the dedicated Seller Center deployment package. It remains isolated from the Customer and Admin frontend deployments, while its **catalog approval workflow is now connected** to the shared Fashion_Fussion Supabase backend.

## Connected now

### Seller authentication and ownership
- Supabase Auth seller sign-in and registration
- Authenticated seller profile in `seller_profiles`
- Seller catalog rows are owner-scoped by authenticated user ID
- Direct browser writes to seller tables are not granted; catalog mutations use authenticated RPC functions with ownership checks
- No service-role secret is exposed to Seller frontend code

### Catalog approval workflow
- Add and edit seller listings
- New or revised listings become `pending`
- Admin sees seller submissions in a dedicated Seller Product Approvals queue
- Admin **Approve** publishes/updates the authoritative customer product
- Admin **Reject** requires a reason that is shown back to the seller
- Rejected listings are not customer-visible
- Editing an already approved listing immediately makes the linked customer product inactive while the revision is pending
- Reapproval reuses the linked customer product rather than creating a duplicate
- Approved listings publish variant/inventory data and optional bulk pricing into the existing customer commerce tables
- Listings without custom seller variants receive one authoritative default SKU/variant so they remain compatible with the current inventory-safe checkout model
- Customer visibility continues to rely on the existing `products.is_active = true` RLS policy

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

## Database verification

A rollback-only end-to-end database assertion has passed for the complete requested path:

- seller registration/profile
- seller product submission
- non-admin approval attempt denied
- admin approval succeeds
- default variant/inventory and bulk tier created when applicable
- approved product visible under anonymous/customer product RLS
- approved listing edit returns it to pending and hides the customer product
- admin rejection stores the exact reason
- rejected product remains invisible under anonymous/customer product RLS

The verification transaction was rolled back. Follow-up checks confirmed no integration-test seller profile, submission or product remained.

## Production-launch prerequisites

Before opening Seller registration publicly:

1. Deploy this branch as the dedicated Vercel project with Root Directory `seller-panel`.
2. Add `https://seller.fashionfussion.in/login` to Supabase Auth redirect URLs (and the exact preview callback only while testing).
3. Enable Supabase **Leaked Password Protection** in Auth password-security settings; Security Advisor currently reports it disabled.
4. Run browser smoke tests against the exact final Seller/Admin/Customer deployments before attaching production domains.
5. Keep `main` and the current live customer project unchanged until all standalone previews pass.

See `VERCEL-SELLER-DEPLOYMENT.md` for the deployment checklist.

## Main files

- `login.html` — Supabase seller sign-in / registration UI
- `auth.js` — seller authentication + profile bootstrap
- `supabase-config.js` — publishable Supabase client setup and dashboard integration preload
- `index.html` — Seller Center dashboard shell
- `app.js` — base seller catalog UI renderer
- `portal.js` — seller workspace/module bootstrap
- `seller-live-integration.js` — authoritative seller catalog/RPC adapter
- `catalog-enhancements.js` — advanced listing/variant/bulk/media fields
- `inventory-fulfillment.js`, `analytics-shipping.js`, `returns-support-team.js`, and other modules — staged operations workspaces; check each module's production boundary before enabling its corresponding real operation

## Deployment boundary

This Seller frontend is deployed separately from Admin and Customer. Do not merge it into `main` merely to deploy it. The final intended host is `seller.fashionfussion.in`, using branch `seller-panel-standalone` and Root Directory `seller-panel`.

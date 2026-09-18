# Fashion_Fussion Seller Panel — Standalone Prototype

This folder is intentionally isolated from the existing Fashion_Fussion storefront and admin panel. It is being prepared first as an independent seller workspace; real backend/admin/storefront integration will happen later.

## Current scope

### Seller access
- Standalone seller sign-in screen
- Standalone seller registration screen
- Demo seller account
- Local seller session / sign-out
- Local seller profile editing

> Authentication in this prototype uses browser storage only. It is **not production authentication** and real credentials must not be used.

### Catalog
- Desktop-first seller dashboard
- Seller product list with search and status filters
- Add product form
- Edit existing product
- Duplicate and delete seller listings
- Review states: `pending`, `approved`, `rejected`
- Approved products shown as **Live** inside the seller panel
- Rejected listings display the admin rejection reason
- Editing any existing listing sends it back to **Pending Review**
- New listings always start as **Pending Review**
- Dashboard counters and review activity feed
- Demo catalog persisted in browser `localStorage`

### Operations preview
- Orders dashboard with sample order states
- Payments / settlement history preview
- Returns queue preview
- Seller Profile & KYC workspace
- Account setup progress
- PAN, GST, bank account and pickup-address placeholders for future verification

## Important: not connected yet

This prototype does **not** currently connect to:

- Fashion_Fussion `products` table
- Supabase Auth
- Admin approval/rejection actions
- Customer storefront
- Product image storage
- Real KYC / GST / PAN verification
- Real bank accounts or settlement provider
- Real customer orders
- Real returns or logistics services

No existing storefront/admin/backend file is required or modified by this folder.

## Run locally

Start with:

`seller-panel/login.html`

Demo credentials:

- Email: `demo@seller.local`
- Password: `seller123`

The prototype is plain HTML/CSS/JavaScript and has no build step.

Use **Reset catalog demo** in the sidebar to restore sample Approved, Pending and Rejected listings.

## Files

- `login.html` — seller sign-in / registration UI
- `auth.js` — local prototype authentication and registration adapter
- `index.html` — seller dashboard shell
- `styles.css` — original seller catalog/dashboard styles
- `portal.css` — seller access, orders, payments, returns and profile styles
- `app.js` — standalone catalog and product-review workflow
- `portal.js` — standalone seller identity, operations and profile workflow

## Planned integration contract

When integration starts, replace the browser-storage adapters with authenticated APIs/database access. Recommended product-review lifecycle:

1. Seller creates listing → `pending`
2. Admin reviews listing
3. Admin approves → `approved` + product becomes eligible for customer storefront
4. Admin rejects → `rejected` + mandatory `rejection_reason`
5. Rejected product remains hidden from customer storefront
6. Seller edits/resubmits → `pending` and previous rejection reason is cleared
7. Any material edit to an approved listing should return it to `pending` until reviewed again

Suggested future ownership/review fields:

- `seller_id`
- `review_status`
- `rejection_reason`
- `reviewed_by`
- `reviewed_at`
- `submitted_at`
- `approved_at`

Suggested future seller modules:

- `sellers`
- `seller_members`
- `seller_addresses`
- `seller_kyc`
- `seller_bank_accounts`
- `seller_products` / seller ownership on products
- `seller_order_items`
- `seller_settlements`
- `seller_returns`

The final database/RLS/API design should be added only when the seller panel is intentionally connected to the main application.

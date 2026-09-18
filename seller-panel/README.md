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

### Seller onboarding & KYC preparation
- Dedicated five-step onboarding workflow
- Business / legal identity section
- Entity type and primary category
- PAN-format validation for fictional/sample values
- Optional GST-registration toggle and GSTIN-format validation
- Settlement-bank form with account-number confirmation and IFSC-format validation
- Pickup-address and dispatch-contact form
- Document-readiness checklist without uploading files
- Seller-specific onboarding progress percentage
- Draft / Pending review / Verified-ready UI states
- Demo verification submission that does not call a real admin or KYC provider
- Onboarding reset action for local prototype data

> Do not enter real PAN, GSTIN, bank account numbers, identity documents or other sensitive details in this standalone build. The workflow is for UI/data-contract preparation only.

### Settings & security
- Account summary and local verification status
- Local notification-preference controls
- Local password change for non-demo accounts
- Demo-account password protection so documented demo credentials keep working
- Session sign-out controls
- Local onboarding reset

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
- Brand, style/model, HSN and country-of-origin fields
- Retail price, MRP, GST and optional bulk/B2B price + MOQ
- Size/color variant matrix with variant-level SKU, stock and optional price override
- Multiple image URLs with primary-image preview
- Package weight, dimensions, dispatch time, return window and low-stock threshold
- Dashboard counters and review activity feed
- Demo catalog persisted in browser `localStorage`

### Inventory
- Dedicated inventory workspace
- Product and variant-level stock rows
- Search + All / Low stock / Out of stock / With variants filters
- Low-stock and out-of-stock counters
- Configurable low-stock thresholds from product listing data
- Bulk `+10` restock action for low-stock SKUs
- Multi-row stock editing with save/discard workflow
- Variant stock automatically recalculates parent product stock
- Inventory update timestamps stored locally

### Orders & fulfilment
- Orders dashboard with persisted sample orders
- Order search by order ID, customer, product or SKU
- Active / New / Processing / Shipped / All filters
- Seller fulfilment flow: `New → Accepted → Packed → Ready to ship → Shipped`
- Order cancellation allowed in early stages
- Visual fulfilment stepper and status badges
- Detailed order modal
- Printable seller invoice preview
- Printable packing slip
- Demo fulfilment reset action

### Analytics
- Gross demo order value
- Total orders, active orders and ordered units
- Live vs total seller listings
- Top products by ordered units
- Operational insights for new orders, dispatch, stock and rejected listings
- Metrics refresh from the same local catalog and fulfilment data

### Notifications
- Seller notification center in the top navigation
- Unread counter
- Rejected-listing alerts
- Low/out-of-stock alerts
- New-order alerts
- Ready-to-ship alerts
- Notification links open the relevant seller workspace
- Read state stored locally

### Shipping & logistics preview
- Dedicated Shipping workspace
- Packed / ready-to-ship / shipped queue
- Demo courier assignment
- Locally generated placeholder AWB/tracking number
- Demo pickup scheduling
- Shipment counters
- Order-document access from the shipping queue

> Courier names, AWB numbers and pickup events in this standalone build are placeholders. They do not create real shipments.

### Other operations preview
- Payments / settlement history preview
- Returns queue preview
- Seller Profile workspace
- Account setup progress

## Important: not connected yet

This prototype does **not** currently connect to:

- Fashion_Fussion `products` table
- Supabase Auth
- Admin approval/rejection actions
- Customer storefront
- Product image storage
- Real inventory reservation / checkout stock sync
- Warehouse or shipping carrier APIs
- Real AWB / shipping labels / courier bookings
- Real invoice or GST-invoice service
- Real KYC / GST / PAN verification
- Real bank-account verification or settlement provider
- Real document storage
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

Use **Reset catalog demo** in the sidebar to restore sample Approved, Pending and Rejected listings. The Orders screen also includes a separate **Reset demo** action for fulfilment states. Settings includes a separate onboarding reset for the current local seller.

## Files

- `login.html` — seller sign-in / registration UI
- `auth.js` — local prototype authentication and registration adapter
- `index.html` — seller dashboard shell
- `styles.css` — original seller catalog/dashboard styles
- `portal.css` — seller access, orders, payments, returns and profile styles
- `app.js` — standalone catalog and product-review workflow
- `portal.js` — seller identity, operations bootstrap and deterministic module loading
- `operations-bootstrap.js` — seeds shared standalone fulfilment data and startup UI normalization
- `catalog-enhancements.js` — advanced listing, variants, bulk pricing, media and shipping fields
- `inventory-fulfillment.js` — inventory workspace and order fulfilment workflow
- `inventory-restock-fix.js` — low-stock bulk restock correction for variant totals
- `analytics-shipping.js` — analytics, notifications, shipping queue, order detail and printable documents
- `onboarding-settings.js` — business onboarding, mock KYC readiness, bank/pickup workflow and account settings

## Planned integration contract

When integration starts, replace the browser-storage adapters with authenticated APIs/database access. Recommended product-review lifecycle:

1. Seller creates listing → `pending`
2. Admin reviews listing
3. Admin approves → `approved` + product becomes eligible for customer storefront
4. Admin rejects → `rejected` + mandatory `rejection_reason`
5. Rejected product remains hidden from customer storefront
6. Seller edits/resubmits → `pending` and previous rejection reason is cleared
7. Any material edit to an approved listing should return it to `pending` until reviewed again

Recommended future onboarding / KYC rules:

1. Seller onboarding data is scoped by authenticated `seller_id`
2. PAN, GSTIN and bank details are encrypted/masked where appropriate and never trusted from browser state alone
3. GST/PAN/bank verification must happen server-side through approved providers
4. Actual KYC documents must use protected object storage with strict authorization
5. KYC status transitions must be auditable (`draft → submitted → reviewing → verified / rejected`)
6. Rejections should include seller-visible reasons and resubmission history
7. Bank-account changes after verification should trigger re-verification
8. Pickup-address changes should be independently validated before logistics activation
9. Authentication must move to Supabase Auth (or another production identity layer); browser-stored passwords must be removed
10. Account/session security should use server-managed sessions, password-reset flows and rate limits

Recommended future inventory/fulfilment rules:

1. Inventory belongs to a seller-owned product or variant SKU
2. Checkout reserves stock transactionally
3. Cancellation/rejected payment releases reserved stock
4. Seller cannot ship more quantity than the accepted order quantity
5. Shipment events should be auditable and timestamped
6. Customer/storefront availability should be driven from sellable stock rather than browser state
7. Courier booking should generate real carrier shipment IDs/AWBs server-side
8. Shipping labels, invoices and packing slips should be generated from authoritative order/tax data
9. Analytics should read immutable order events rather than browser-local demo state
10. Notifications should be seller-scoped and generated from backend events

Suggested future ownership/review fields:

- `seller_id`
- `review_status`
- `rejection_reason`
- `reviewed_by`
- `reviewed_at`
- `submitted_at`
- `approved_at`
- `inventory_updated_at`
- `kyc_status`
- `kyc_submitted_at`
- `kyc_reviewed_at`

Suggested future seller modules:

- `sellers`
- `seller_members`
- `seller_addresses`
- `seller_kyc`
- `seller_kyc_documents`
- `seller_bank_accounts`
- `seller_preferences`
- `seller_products` / seller ownership on products
- `seller_inventory`
- `seller_product_variants`
- `seller_order_items`
- `seller_order_events`
- `seller_shipments`
- `seller_shipment_events`
- `seller_notifications`
- `seller_settlements`
- `seller_returns`

The final database/RLS/API design should be added only when the seller panel is intentionally connected to the main application.

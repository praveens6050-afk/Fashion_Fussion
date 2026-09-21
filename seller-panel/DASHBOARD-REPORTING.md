# Seller Dashboard, Reporting & Bulk Catalog — Standalone Contract

This module is part of the isolated `seller-panel/` prototype and does not connect to the production storefront, admin panel, checkout, warehouse, or Supabase.

## Dashboard customization

The Overview page can locally show or hide:

- summary listing cards
- approval workflow notice
- recent listings
- review activity
- operations snapshot
- quick actions

Preferences are scoped to the signed-in prototype seller and stored in browser `localStorage`.

## Activity log

`dashboard-reports-bulk.js` records a browser-local audit-style history for seller actions that flow through shared seller notifications or catalog commits. The log is capped and is intended only to prepare the future audit UI.

It is **not** a production security or compliance audit log. Production events should be immutable, server timestamped, seller/user scoped, and protected from client-side modification.

## CSV reports

Browser-generated CSV exports are available for:

- catalog
- inventory / variant inventory
- fulfilment orders
- returns
- B2B quotation requests
- local activity history

Downloads are generated from current standalone browser state. No data is uploaded by the report generator.

## Bulk catalog import

The CSV importer follows a preview-first workflow:

1. select a UTF-8 CSV file (prototype limit: 2 MB)
2. parse and validate rows in the browser
3. inspect New / Update / Error states
4. explicitly apply valid rows
5. all imported new listings become `pending`
6. existing-SKU content updates also become `pending`
7. rejection reason / review timestamp are cleared on resubmission
8. variant-product stock is not overwritten by CSV; variant inventory remains managed from Inventory

Required columns:

`sku,name,category,price,mrp,stock,gst,brand,description`

Optional columns:

`country_origin,bulk_enabled,bulk_min_qty,bulk_price,image`

Validation includes:

- unique SKU inside the CSV
- positive selling price
- MRP >= selling price
- whole-number non-negative stock
- GST limited to prototype-supported rates (0/5/12/18/28)
- HTTP/HTTPS image URLs only
- valid bulk MOQ and bulk price when bulk pricing is enabled

## Production integration rules

When this standalone UI is connected later:

- imports should be processed server-side in a transactional job
- seller ownership must be enforced by authenticated `seller_id`
- file size, MIME type, row count, encoding, formula injection, and malicious content must be validated server-side
- import preview and apply should use an immutable import batch ID
- partial failures should have row-level error records
- duplicate SKU rules should be enforced in the database
- material product changes should enter the real admin review workflow
- variant inventory must use authoritative variant IDs rather than CSV text alone
- reports should be generated from authorized backend queries, not browser storage
- large exports should use asynchronous server jobs with expiring authorized download URLs
- activity/audit events should be append-only and server controlled

Current browser keys used by this phase:

- `ff_seller_activity_log_v1`
- `ff_seller_dashboard_prefs_v1`
- existing catalog/order/return/quote prototype stores

# Customer Operations, Locations, SLA & Reconciliation

This module is part of the isolated `seller-panel/` prototype. It does not connect to the Fashion_Fussion storefront, admin panel, Supabase, payment providers, banks, couriers or real customers.

## Customer Q&A

- Seller-scoped local message store
- Needs reply / Answered / All filters
- Search by product, SKU or customer display name
- Local reply / edit reply / close / reopen actions
- Sidebar count for questions needing a reply
- Replies never leave the browser in this prototype

Production requirements:

- authenticated customer and seller identities
- moderation / abuse controls
- rate limits
- immutable message timestamps
- delivery/read state from backend events
- customer notification preferences
- authorization by seller-owned product/order context

## Warehouse & pickup locations

- Pickup, warehouse and return-center location types
- One active default pickup location
- Activate / disable locations
- Delete non-default locations
- Local phone and PIN-format checks
- Seller-scoped local persistence

Production requirements:

- protected address storage
- courier serviceability and postcode validation
- geo/address normalization where required
- pickup/return activation workflow
- verified seller ownership
- auditable changes to default fulfilment location

## SLA & service metrics

Prototype indicators:

- customer response completion
- order action progress
- dispatch progress
- return resolution
- customizable local target percentages

These are demo health indicators only. They are not contractual SLAs, penalties, guarantees, seller ranking inputs, or marketplace eligibility rules.

Production SLA metrics should be calculated from authoritative event timestamps such as order-created, seller-accepted, packed, pickup, shipped, delivered, return-requested and refund-completed events.

## Payout reconciliation

- Expected net payout
- Recorded demo payout
- Fees
- Difference calculation
- Reconciled / Unreconciled / Mismatch states
- Editable demo recorded values
- CSV export
- Demo reset

No real funds move and no accounting entry is created.

Production reconciliation requirements:

1. payment-provider settlement IDs must be immutable
2. order/payment/refund/fee ledgers must be server-side authoritative
3. bank/provider statements should be imported through authenticated integrations or controlled ingestion
4. reconciliation actions must record actor, timestamp, source and reason
5. mismatches should support investigation states instead of being silently overwritten
6. settled/refunded values should be idempotent and linked to source transactions
7. tax/fee accounting should be derived from authoritative financial records
8. exports should be generated from server-side data with access controls

## Source

Main module: `customer-ops-accounting.js`

The module is loaded after the existing reporting/dashboard modules so it can read the already-seeded local order/return demo data while remaining independent from the main application.
# Fashion_Fussion Seller Panel — QA & Integration Readiness

This document records the standalone seller-panel QA pass performed before any connection to the existing Fashion_Fussion storefront, admin panel or production backend.

## Scope of this QA pass

The review covered the desktop standalone seller flow and cross-module contracts for:

- seller sign-in / registration prototype
- catalog and product review states
- variants, bulk pricing and media
- inventory and low-stock workflows
- fulfilment orders and shipping preview
- analytics and notifications
- seller onboarding / KYC preparation
- returns, support, tax and team roles
- promotions and B2B quotations
- reports, CSV import/export and activity history
- customer Q&A, seller locations, SLA metrics and reconciliation
- plan / fee simulation, compliance checks and help center
- navigation, keyboard shortcuts, sidebar layout and seller-scoped browser state

## Fixes applied during QA

### 1. Desktop sidebar overflow

The seller navigation now scrolls independently when the long desktop menu exceeds the viewport. The brand and sidebar footer stay accessible.

### 2. Keyboard shortcut conflict

`Ctrl/Cmd + Shift + K` is now intercepted before the older global `Ctrl/Cmd + K` product-search listener. The quick workspace switcher opens without also focusing the product search behind it.

### 3. Inventory unsaved-change count

Variant parent stock is calculated automatically and is read-only. It is no longer counted as a second manual unsaved change when a variant stock row is edited.

### 4. Same-tab dashboard freshness

Seller actions that emit the shared notification callback now also trigger a local refresh signal. Dashboard operational counters therefore refresh after same-tab order, return, quote, inventory and similar actions instead of relying only on browser `storage` events from another tab.

### 5. Reconciliation state guard

A settlement whose payout status is still `pending` cannot be marked reconciled even when its demo expected and recorded values happen to match. The action is disabled until the payout is represented as paid.

### 6. Seller browser-state isolation

The original prototype used shared browser keys for catalog, fulfilment orders, shipping metadata and notification-read state even though multiple local seller accounts can be registered.

The standalone build now scopes these keys per seller account:

- `ff_seller_panel_demo_v1`
- `ff_seller_fulfillment_orders_v1`
- `ff_seller_shipping_meta_v1`
- `ff_seller_notification_reads_v1`

A one-time legacy claimant preserves the old shared demo state for the first seller opening the upgraded build. Other/new sellers start with their own starter data instead of inheriting another seller's frozen prototype state.

This browser scoping is a prototype compatibility layer only. Production seller ownership must be enforced in the database/API authorization layer.

## Runtime self-audit

`qa-final-fixes.js` performs a delayed structural browser audit and stores the latest result under `ff_seller_qa_last_v1`, scoped by seller inside that record.

It checks:

- duplicate DOM IDs
- navigation buttons that have no corresponding `view-*` section
- number of active content views
- required core seller elements

Failures are written to the browser console. This is a diagnostic aid, not a substitute for automated browser tests.

## Static verification completed

The QA hardening module and seller-storage scoping module were syntax-checked with Node before being written to the branch.

The final branch diff must remain limited to `seller-panel/` until integration is explicitly started.

## Browser-runtime limitation in this QA environment

A full local browser smoke test could not be executed from the current work container because direct GitHub clone/network resolution is unavailable (`github.com` cannot be resolved from the container). The source branch itself remains accessible through the connected GitHub integration, so source audit and branch isolation checks can still be completed.

Before production integration, run a real Chromium/Playwright smoke suite against a local or preview deployment.

## Required production integration contracts

### Authentication and seller ownership

- Replace browser-stored passwords with Supabase Auth or another production identity provider.
- Every seller-owned record must carry an authoritative `seller_id`.
- Do not trust seller IDs, roles or KYC state supplied by the browser.
- Enforce ownership and staff permissions server-side / with database RLS.

### Catalog review

- Persist seller listing drafts separately or with explicit seller ownership.
- New/materially edited listings enter `pending` review.
- Admin approval controls customer eligibility.
- Rejection requires a seller-visible reason and audit metadata.
- Customer storefront queries must never expose rejected or pending seller listings.

### Inventory

- Inventory must be SKU/variant scoped and transactionally reserved at checkout.
- Payment failure/cancellation must release reservations safely.
- Quantity-only seller updates should not silently bypass inventory audit history.
- Never rely on browser-local totals as authoritative stock.

### Orders and fulfilment

- Use immutable order lines and auditable fulfilment events.
- Validate allowed status transitions server-side.
- Prevent sellers from modifying orders they do not own.
- Shipment/AWB creation must come from authoritative logistics integrations.

### Returns and refunds

- Return eligibility must use authoritative order/payment policy data.
- Refunds must be idempotent provider-side operations.
- Record refund IDs, payment references and status transitions server-side.

### KYC, tax and banking

- Treat PAN, GSTIN, bank data and documents as sensitive production data.
- Encrypt/mask where appropriate and use protected object storage.
- Verification and status transitions must be server-generated and auditable.
- Invoice numbers must be allocated atomically from authoritative tax/order data.

### Settlements and accounting

- Use immutable settlement/provider ledger records.
- Reconciliation must compare authoritative expected, provider and bank values.
- Browser-edited payout amounts must not exist in production accounting flows.

### Messaging and support

- Customer/seller identities must be authenticated.
- Add authorization, moderation, abuse controls and retention rules.
- Notifications should be event-driven and seller scoped.

### Audit logging

- Production audit logs must be append-only, server timestamped and actor identified.
- Browser-local activity history is only a UX preview and must not be treated as a security log.

## Recommended pre-integration regression suite

1. Sign in with seller A; change catalog, order status and notification state.
2. Sign out and create/sign in as seller B; verify seller A state is not visible.
3. Add, edit, duplicate and delete a listing; confirm review-state rules.
4. Edit variant inventory; confirm parent total and unsaved-change count.
5. Run low-stock restock and confirm totals persist.
6. Move an order through every fulfilment state and verify analytics/dashboard refresh.
7. Exercise return approve → pickup → received → refund and rejection paths.
8. Create/revise/accept/decline B2B quotes.
9. Validate CSV import with new, update, invalid, duplicate-SKU and variant-SKU cases.
10. Verify pending payouts cannot be reconciled.
11. Test every sidebar navigation item and quick-switch target.
12. Test `Ctrl/Cmd + K` and `Ctrl/Cmd + Shift + K` independently.
13. Check notification panel, order modal, product drawer and customization modal together for z-index/focus conflicts.
14. Run duplicate-ID and missing-view assertions after all dynamic modules load.
15. Run desktop viewport screenshots at common widths before integration.

## Architecture recommendation before production connection

The standalone prototype intentionally uses multiple classic JavaScript modules that inject views dynamically. Before wiring production APIs, consolidate the module boundaries into a maintainable application architecture and add automated unit/integration/E2E tests. Do not carry the Storage monkey-patch or browser-only authorization model into production.

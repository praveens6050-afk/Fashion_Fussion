# Seller Plans, Fees, Compliance & Help — Standalone Prototype

This phase remains isolated inside `seller-panel/` and is not connected to production billing, marketplace policy enforcement, customer checkout, admin review services, or legal/tax compliance providers.

## Plans & fee simulator

The Seller Center now includes three fictional demo plan assumptions:

- Starter Demo
- Growth Demo
- Scale Demo

Plan prices, commission percentages, handling charges and features are illustrative UI values only. Selecting a demo plan stores the choice for the current local seller and does not create a subscription, invoice, payment mandate or charge.

The fee simulator can use a catalog product or custom selling price and calculates an illustrative breakdown using:

- gross sale value
- fictional marketplace commission
- fictional payment-processing percentage
- fictional order-handling fee
- seller-entered shipping assumption
- illustrative tax on platform fees
- estimated seller proceeds

The calculator is not an accounting, GST, tax, settlement, or contractual pricing engine.

## Product compliance center

The Compliance workspace reads existing seller listing fields and produces a data-completeness health check. Checks include:

- product name and description completeness
- category, brand and SKU
- price / MRP relationship
- primary and additional product media
- country of origin
- optional HSN-format advisory
- package weight and dimensions
- dispatch time
- return-window configuration
- bulk MOQ / bulk price when enabled
- variant SKU and stock integrity when variants are enabled

Listings are labeled `Ready for review` only when required prototype data checks pass. This does **not** mean the product is legally compliant or approved for sale.

Production compliance must be enforced through authoritative rule sets for applicable categories and jurisdictions, including safety, labeling, tax, trademark, restricted goods, documentation, product certifications and marketplace policy requirements.

## Announcements & help center

The standalone Help Center includes:

- local seller-product announcements
- unread/read announcement state
- searchable help topics
- direct navigation to relevant Seller Center workspaces
- guidance that clearly distinguishes prototype workflows from real integrations

No remote CMS, support knowledge base or admin-announcement service is connected yet.

## Desktop UX polish

The Seller Center now includes a quick workspace switcher in the desktop top bar.

- Click `Quick switch`, or use `Ctrl/Cmd + Shift + K`
- Type to filter available seller workspaces
- Press Enter to open the first result
- Escape closes the switcher
- Existing `Ctrl/Cmd + K` product search remains available

Focus-visible treatment was also strengthened for buttons and form controls.

## Production integration rules

When this phase is connected to the main application:

1. Seller plans must come from server-authoritative commercial configuration.
2. Subscription status must come from the billing provider and backend, never local browser state.
3. Fee calculations must use versioned category/rate tables and authoritative order values.
4. Taxes, withholding, settlement fees and invoices must use validated jurisdiction-specific rules.
5. Product compliance must be based on versioned marketplace policies and category requirements.
6. Compliance evidence and product documents must use protected storage and auditable review records.
7. Help-center content and announcements should come from an admin/CMS workflow.
8. Announcement read state must be seller/user scoped server-side when cross-device persistence is required.
9. Navigation permissions must be filtered by authenticated seller-member roles.
10. Keyboard/desktop accessibility should receive full browser and assistive-technology verification before production release.

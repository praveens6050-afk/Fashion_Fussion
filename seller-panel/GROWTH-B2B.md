# Seller Growth, B2B Quotes & Quality Score — Standalone Prototype

This module is intentionally browser-local and is not connected to Fashion_Fussion customer checkout, admin, Supabase, payments, or live pricing.

## Promotions & coupons

- Create percentage or fixed-amount coupon previews.
- Set minimum order value, maximum discount, and customer scope (`all`, `retail`, or `business`).
- Activate/pause or delete local coupon records.
- Coupon records do not affect storefront checkout or customer pricing.

## Pricing campaigns

- Create a campaign for a seller product.
- Configure discount percentage and start/end dates.
- Preview promotional price against the existing seller catalog price.
- Pause/resume or delete campaigns.
- Base catalog price is never overwritten by the campaign module.

## B2B quotation requests

- Local sample RFQs represent business/bulk-buyer requests.
- Seller can prepare/revise per-unit offer price, MOQ and validity date.
- Seller can decline a request or mark a quoted request accepted for demo purposes.
- No buyer notification, contract, payment, stock reservation, or bulk order is created.

## Performance / quality scorecard

The scorecard is a demo operational-health indicator only. It is not a marketplace ranking and has no effect on customer visibility, search ranking, seller eligibility, payouts, or account enforcement.

It currently combines five equally weighted local signals:

1. Catalog health — approved vs rejected local listings.
2. Fulfilment — local shipped/cancelled order states.
3. Inventory — products above their low-stock threshold.
4. Return health — local return/refund volume relative to demo orders.
5. Seller setup — presence of selected local onboarding fields.

## Production integration rules

When this module is intentionally connected later:

- Coupon eligibility and redemption must be validated server-side and atomically at checkout.
- Promotion stacking, usage limits, expiry, seller funding and abuse controls need authoritative backend rules.
- Campaign prices should be derived from versioned price rules, not destructive edits to base price.
- B2B RFQs must be scoped to authenticated buyer/seller organizations with auditable negotiations and expiry.
- Accepted quotations should create orders only through an authoritative backend transaction with inventory reservation.
- Seller quality metrics should be computed from reliable order, return, SLA and policy-event data rather than browser-local state.
- Any production quality metric used for seller actions should have documented definitions, auditability and appeal/correction paths.

Current implementation: `growth-b2b-scorecard.js`.

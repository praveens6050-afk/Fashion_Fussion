# Fast Dispatch rollout

Fast Dispatch is intended to be a performance-derived trust signal, not a seller-controlled badge.

## Eligibility target (not currently enabled)

Once trustworthy seller-level dispatch data exists, the intended eligibility rules are:
- At least 10 shipped/delivered orders with valid seller-level dispatch-handoff timestamps.
- At least 90% dispatched within 24 hours of order creation.
- Average dispatch time no greater than 24 hours.

These thresholds are a future eligibility contract, not evidence that the current schema can calculate the metric.

## Current implementation status: fail-closed

The current schema does not support a trustworthy seller-specific calculation:
- `orders` has no `seller_id`; order line items are stored in `orders.items` JSONB and may represent mixed-seller carts.
- `orders.fulfillment_updated_at` is order-level and does not prove when an individual seller handed a shipment to a carrier.
- The current `order_shipments` schema does not provide a verified seller-level handoff timestamp.

Accordingly, `get_seller_fast_dispatch_signal(uuid)` intentionally returns zero verified samples, NULL rate/average metrics, and `fast_dispatch = false` for every seller. This avoids a migration failure and prevents unverified order-level timestamps from creating a misleading badge. Do not replace this with a guessed column or infer seller performance from product ownership.

## Requirements before enabling the signal

1. Design and review a durable seller-attributed order-line/fulfillment model that supports mixed-seller carts.
2. Capture a verified seller-specific dispatch-handoff timestamp from the actual fulfillment/carrier handoff event. Do not substitute order status-update time.
3. Update checkout and fulfillment/shipping integration paths to persist the required attribution and timestamp.
4. Add seeded metric tests for the 10-order minimum, 90% within-24-hour threshold, average-time threshold, missing/invalid timestamps, and mixed-seller orders.
5. Validate permissions, backend-only access, and the public-safe marketplace integration; run seeded and production smoke tests only through an explicitly approved release process.

## Security

The raw seller-performance RPC is backend-only (`service_role`). Customer-facing code must receive only the derived public-safe signal through a trusted marketplace API/RPC. Sellers cannot set or override eligibility.

## Product semantics

Fast Dispatch means seller dispatch performance only. It must not be presented as a guaranteed delivery date or same-day/next-day delivery promise.

## Release gate

Do not expose the badge in production until the seller-level data model exists, real handoff timestamps are verified consistently, the metric implementation and seeded tests pass, public-safe marketplace integration is implemented, and production smoke tests are explicitly approved and pass.

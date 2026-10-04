# Fast Dispatch rollout

Fast Dispatch is a performance-derived trust signal, not a seller-controlled badge.

## Eligibility
- At least 10 shipped/delivered orders with valid fulfillment timestamps.
- At least 90% dispatched within 24 hours of order creation.
- Average dispatch time no greater than 24 hours.

## Security
The raw seller-performance RPC is backend-only (`service_role`). Customer-facing code must receive only the derived public-safe signal through a trusted marketplace API/RPC. Sellers cannot set or override eligibility.

## Product semantics
Fast Dispatch means seller dispatch performance only. It must not be presented as a guaranteed delivery date or same-day/next-day delivery promise.

## Release gate
Do not expose the badge in production until the migration is applied, real fulfillment timestamps are verified to represent shipment handoff consistently, public-safe marketplace integration is implemented, and seeded plus production smoke tests pass.

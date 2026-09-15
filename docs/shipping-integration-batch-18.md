# Shipping integration batch 18 — Shiprocket foundation

## Provider decision

Fashion_Fussion uses Shiprocket as the first shipping-provider integration because the store needs a multi-courier path that can support normal retail orders and larger business orders without changing the customer checkout model. The implementation keeps provider data in a separate `order_shipments` table so a direct provider such as Delhivery can be added later without rewriting orders.

## What this batch adds

- Server-only shipping actions multiplexed through the existing `/api/admin-order-action` Vercel function so the Hobby deployment remains within its 12-function limit.
- Admin-only configuration status and shipment creation actions.
- Shiprocket authentication and custom-order creation call.
- Admin-entered package weight and dimensions; product catalogue dimensions are not invented.
- Separate `order_shipments` persistence for provider order/shipment IDs, courier, AWB, provider status and tracking URL when available.
- Customer courier information on Order Details through an authenticated ownership-checked backend action.
- Admin Shipping / Shiprocket panel with recent shipment records.
- RLS-enabled shipment table with direct `anon` and `authenticated` access revoked.

## Activation gate

Live Shiprocket booking requires these server environment variables:

- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_PICKUP_LOCATION`

If any value is missing, the shipping API reports the integration as not configured and refuses live shipment creation. Credentials and Shiprocket access tokens are never sent to browser code.

## Fulfilment safety

A courier shipment can be created only when:

- the Fashion_Fussion order is currently `packed`;
- a prepaid order is `paid`, or a COD order remains in an eligible COD payment state; and
- valid package weight, length, breadth and height are supplied by an admin.

Creating a provider shipment does **not** automatically change Fashion_Fussion fulfilment to `shipped`. The existing ordered → packed → shipped → out for delivery → delivered admin state machine remains authoritative until carrier-status synchronization is deliberately implemented and verified.

## Deliberate non-claims

This batch does not claim:

- that Shiprocket is live until production credentials are configured and a real booking succeeds;
- that an AWB or courier is assigned by the initial Shiprocket order-creation response;
- a fixed courier, service area or delivery ETA;
- automatic courier selection, pickup booking or carrier-driven fulfilment transitions;
- product-level package dimensions that are not present in the current catalogue.

## Database migration

The `add_order_shipments_shiprocket` migration was applied to the Fashion_Fussion Supabase production project before the application code was merged. The repository migration file mirrors that production DDL. Supabase CLI was not available in the execution environment, so the migration was applied through the connected Supabase management tool.

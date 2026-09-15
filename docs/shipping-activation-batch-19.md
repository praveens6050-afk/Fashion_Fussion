# Shipping activation batch 19 — Shiprocket dispatch workflow

## Goal

Extend the Batch 18 Shiprocket foundation into the complete provider-side dispatch sequence while keeping provider credentials server-only and keeping Fashion_Fussion fulfilment states under the existing admin workflow.

## Shiprocket account prerequisites

Before live booking, the Shiprocket merchant account should have its normal provider-side onboarding completed, including the applicable company/KYC setup, a pickup address/location and sufficient wallet/plan readiness for shipping charges.

Create a dedicated Shiprocket API User from Shiprocket Settings → API. The API User email must be different from the merchant account's registered login email. The server must use this API User email/password rather than putting the merchant dashboard login credentials into browser code.

## Production environment variables

Configure these as server environment variables in Vercel; never commit their values to GitHub:

- `SHIPROCKET_EMAIL` — dedicated Shiprocket API User email.
- `SHIPROCKET_PASSWORD` — dedicated Shiprocket API User password.
- `SHIPROCKET_PICKUP_LOCATION` — Shiprocket pickup-location nickname used when creating an order.
- `SHIPROCKET_PICKUP_PINCODE` — six-digit pickup pincode used only for courier serviceability queries.

The admin panel only receives boolean readiness flags. It never receives the credential values or Shiprocket bearer token.

## Admin dispatch sequence

1. Mark an eligible Fashion_Fussion order `Packed` using the existing fulfilment workflow.
2. Enter the final packed parcel's weight and dimensions.
3. Use **Check couriers** to query Shiprocket serviceability for the pickup/delivery pincodes and payment mode.
4. Create the Shiprocket shipment/order.
5. Assign an AWB. An admin may supply a courier ID returned by serviceability or leave it blank so Shiprocket can use its default selection behavior.
6. Request pickup only after an AWB exists.
7. Use **Sync** to copy the latest Shiprocket carrier status and tracking URL into the secure `order_shipments` record.

Provider rates and estimated delivery values shown in the admin panel come from Shiprocket's current API response. They are operational guidance, not customer-facing delivery guarantees.

## Safety boundaries

- Checkout, pricing, order creation, inventory and payment processing are unchanged.
- Carrier state does not automatically advance `orders.fulfillment_status`.
- Customer Order Details only receives safe courier fields from an authenticated ownership-checked backend action.
- Direct browser access to `order_shipments` remains blocked by the Batch 18 RLS/grant model.
- A pickup request requires an existing AWB.
- Missing environment configuration fails closed.
- No fixed courier, service area, pickup success, delivery ETA or AWB assignment is claimed until Shiprocket actually returns it.

## Verification target

Before enabling real shipments, verify the exact production deployment, Quality Gate/Desktop browser smoke test, activation checklist, one controlled Shiprocket serviceability query and one controlled real shipment lifecycle using a legitimate order and real provider account.
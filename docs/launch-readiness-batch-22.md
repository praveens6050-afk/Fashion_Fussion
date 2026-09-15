# Launch readiness batch 22 — checkout/order lifecycle preflight

## Goal
Verify whether Fashion_Fussion can safely run the first real retail checkout without creating fake production orders or charging a customer during readiness testing.

## Production audit findings
- Required checkout/order RPCs are present in production Supabase.
- Current production data has 0 active products, 0 orders, 0 saved customer addresses, 0 active variants and 0 inventory rows.
- Therefore a real COD or prepaid checkout cannot honestly be executed yet.

## Changes
- Added an admin-only Checkout Readiness card.
- Added a non-destructive server preflight through the existing `/api/admin-order-action` function.
- Preflight checks active catalogue/order counts, the current admin test account delivery-address readiness, required checkout RPC exposure, Razorpay credential authentication and webhook-secret configuration.
- Razorpay verification uses a read-only GET request and never creates an order, payment, refund or capture.
- Added CI source guards for the preflight and destructive-action prohibition.

## Readiness meaning
- `COD real test` requires server/database readiness, at least one active product, the current admin test account to have a saved delivery address and all required checkout RPCs.
- `Prepaid real test` requires the COD prerequisites plus successful Razorpay API authentication and a configured Razorpay webhook secret.
- These statuses mean the controlled real test may be attempted; they do not claim that a live customer transaction has already been completed.

## Guardrails
- No fake production product, customer address or order was created.
- No payment, capture, refund, shipment or inventory movement is initiated by this preflight.
- Checkout pricing, payment creation, cancellation and fulfilment behavior are unchanged.
- Vercel function count is preserved by reusing the shared admin action function.

# Launch readiness batch 24 — first live order ladder

## Production starting state

The production database was checked before this batch. It contained zero products, zero active products, zero variants, zero inventory rows, zero orders and zero courier shipments. No commercial product, price, GST, SKU, stock, customer order or shipment data is invented by this batch.

## What this batch adds

The Admin Dashboard now gets a **First Live Order Readiness** card. It combines the already-safe checkout and Shiprocket diagnostics with current catalog, inventory, order and shipment state so the operator can see one end-to-end ladder:

1. Sellable catalog — at least one active product with an active SKU whose available stock (`on_hand - reserved`) is above zero.
2. COD checkout readiness.
3. Prepaid checkout readiness.
4. Shiprocket authentication + serviceability configuration.
5. At least one payment-valid order in `packed` fulfillment state.
6. Forward shipment creation.
7. AWB assignment.
8. Pickup request.

The card also calculates the **next safe action** from the first blocked stage.

## Safety

This is a read-only preflight. It only calls the existing admin actions `checkout_health`, `connection_test` and `admin_list`, plus authenticated SELECT queries for catalog/inventory/order state. It never creates an order, payment, refund, shipment, AWB or pickup request, and it does not alter fulfillment or inventory.

A CI source guard prevents the readiness file from invoking mutation actions or Supabase writes.

## Why the real shipment is still pending

A real Shiprocket serviceability/booking test needs a genuine sellable product, a controlled real customer order, a real delivery address, and realistic package weight/dimensions. Those values must come from the business/operator and are not fabricated in production.

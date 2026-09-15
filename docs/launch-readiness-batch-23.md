# Launch readiness batch 23 — Catalog, variants and inventory

## Goal
Make the first real checkout test safe by preventing newly-created catalog items from becoming sellable before SKU and stock setup is complete.

## Production audit
- Production currently has no sellable catalog rows, variants or inventory rows.
- `products`, `product_variants` and `inventory_levels` already use admin-aware RLS.
- `admin_set_variant_inventory` is a SECURITY DEFINER RPC that verifies the caller is an administrator and writes an inventory movement audit record.
- Product `cost` remains private from browser SELECT while admin cost access stays server-side.

## Fix
- New `products.is_active` default is `false`.
- Database trigger `products_activation_readiness_guard` blocks activation unless:
  - `has_variants=true`, and
  - at least one active variant has `(on_hand - reserved) > 0`.
- Admin catalog UI defaults new-product status to Inactive and shows the safe publish sequence.

## Safe publish sequence
1. Create product as Inactive.
2. Add at least one SKU/variant.
3. Set on-hand stock through Variants & Inventory.
4. Confirm available stock is above zero.
5. Edit the product and activate it.

## Safety
No product data, stock values, prices or GST values are invented by this batch. Existing order snapshots are unchanged. The guard only applies when a product transitions into Active state.

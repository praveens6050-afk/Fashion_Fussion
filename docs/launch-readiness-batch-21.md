# Launch Readiness Batch 21 — Product feature column permissions

## Goal
Restore the non-sensitive product feature columns required by the desktop storefront and admin inventory UI without exposing product cost data.

## Root cause
`public.products` intentionally uses column-level SELECT grants to keep `cost` private. Later feature columns were added but were not added to those SELECT grants. As a result:

- `product.html` can request `bulk_enabled` and `bulk_min_qty` for Business / Bulk buying.
- `product-variants.js` and `admin-inventory.js` can request `has_variants`.
- PostgreSQL rejects those reads before RLS can authorize the row, producing `permission denied for table products`.

## Change
Grant SELECT on only these non-sensitive columns to `anon` and `authenticated`:

- `bulk_enabled`
- `bulk_min_qty`
- `has_variants`

Existing row-level security policies remain unchanged. No SELECT grant is added for `products.cost`.

## Guardrails
- No checkout, payment, shipping, pricing calculation, order, quote, or inventory mutation behavior changes.
- `products.cost` remains inaccessible to browser roles.
- Existing product RLS continues to limit anonymous users to active products and allows admins to see inactive products when authenticated.
- Source checks fail if this migration starts granting `products.cost` or whole-table SELECT.

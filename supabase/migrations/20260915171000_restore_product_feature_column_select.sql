-- Restore access to non-sensitive product feature flags used by the storefront and admin inventory UI.
-- Keep product cost private: do not grant SELECT on public.products.cost.

grant select (bulk_enabled, bulk_min_qty, has_variants)
on table public.products
to anon, authenticated;

notify pgrst, 'reload schema';

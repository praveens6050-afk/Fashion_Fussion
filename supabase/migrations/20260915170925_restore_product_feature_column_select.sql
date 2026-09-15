grant select (bulk_enabled, bulk_min_qty, has_variants)
on table public.products
to anon, authenticated;

notify pgrst, 'reload schema';
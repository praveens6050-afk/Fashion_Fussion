grant select(cost) on table public.products to anon,authenticated;
notify pgrst,'reload schema';
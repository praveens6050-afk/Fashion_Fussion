-- Applied to production as migration 20260908221102 hide_product_cost_from_clients.
revoke select on table public.products from anon,authenticated;
grant select(id,name,category,price,rating,reviews,image_url,badge,description,is_active,created_at,updated_at,gst_rate)
on table public.products to anon,authenticated;
notify pgrst,'reload schema';

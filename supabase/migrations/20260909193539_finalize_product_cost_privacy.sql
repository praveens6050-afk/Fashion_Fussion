-- Re-apply product cost privacy on complete schemas. The reconstructed local
-- replay baseline may omit the production products relation.
do $product_cost_privacy$
begin
  if to_regclass('public.products') is not null then
    revoke select on table public.products from anon, authenticated;
    grant select(id,name,category,price,rating,reviews,image_url,badge,description,is_active,created_at,updated_at,gst_rate)
      on table public.products to anon, authenticated;
  end if;
end
$product_cost_privacy$;

notify pgrst, 'reload schema';

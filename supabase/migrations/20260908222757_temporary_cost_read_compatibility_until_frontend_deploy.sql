-- Keep the temporary compatibility grant on complete schemas while allowing
-- clean replays whose reconstructed baseline does not include products.
do $temporary_product_cost_grant$
begin
  if to_regclass('public.products') is not null then
    grant select(cost) on table public.products to anon, authenticated;
  end if;
end
$temporary_product_cost_grant$;

notify pgrst, 'reload schema';

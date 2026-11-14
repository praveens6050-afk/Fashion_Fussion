begin;

-- Keep the existing product-facing RPC contracts while moving privileged
-- implementations behind the non-exposed private schema.
alter function public.get_variant_availability(bigint) security invoker;
alter function public.get_variant_availability(bigint) set search_path = '';

alter function public.get_marketplace_product_signals() set schema private;
revoke all on function private.get_marketplace_product_signals() from public, anon, authenticated;
grant execute on function private.get_marketplace_product_signals() to anon, authenticated, service_role;

create or replace function public.get_marketplace_product_signals()
returns table(
  product_id bigint,
  seller_id uuid,
  verified_seller boolean,
  visibility_boost_active boolean,
  value_signal text,
  category_reference_price numeric,
  relevance_boost integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.get_marketplace_product_signals();
$function$;

revoke all on function public.get_marketplace_product_signals() from public;
grant execute on function public.get_marketplace_product_signals() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;

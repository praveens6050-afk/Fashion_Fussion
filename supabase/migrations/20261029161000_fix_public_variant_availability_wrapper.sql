begin;

create or replace function public.get_variant_availability(p_product_id bigint)
returns table(variant_id bigint, in_stock boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  select * from private.get_variant_availability(p_product_id);
$function$;

notify pgrst, 'reload schema';

commit;

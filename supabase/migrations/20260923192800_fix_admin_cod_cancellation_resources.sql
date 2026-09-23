create or replace function public.cancel_cod_order_service(p_order_id bigint, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  o public.orders%rowtype;
begin
  if not exists(
    select 1 from public.profiles p
    where p.id = p_admin_id and p.is_admin = true
  ) then
    raise exception 'Admin access required';
  end if;

  select * into o
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if o.payment_method <> 'cod' then raise exception 'Order is not COD'; end if;
  if o.status = 'cod_cancelled' then return; end if;
  if o.status <> 'cod_pending' then raise exception 'Only pending COD orders can be cancelled'; end if;

  perform public.release_order_inventory(o.id);
  perform public.restock_cancelled_order_inventory(o.id);

  update public.orders
  set status = 'cod_cancelled',
      fulfillment_status = 'cancelled',
      fulfillment_updated_at = now(),
      payment_source = 'cod_cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      cancellation_reason = coalesce(nullif(btrim(cancellation_reason), ''), 'Cancelled by administrator')
  where id = o.id;

  perform public.restore_cancelled_order_promotions(o.id, o.user_id);
end;
$function$;

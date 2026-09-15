create or replace function public.restock_cancelled_order_inventory(p_order_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service role required'; end if;
  for r in select * from public.order_inventory_reservations where order_id=p_order_id and status='committed' for update loop
    update public.inventory_levels set on_hand=on_hand+r.quantity,updated_at=now() where variant_id=r.variant_id;
    if not found then raise exception 'Inventory level missing for variant %',r.variant_id; end if;
    update public.order_inventory_reservations set status='released',released_at=now(),updated_at=now() where order_id=p_order_id and variant_id=r.variant_id;
    insert into public.inventory_movements(variant_id,movement_type,quantity_delta,reference_type,reference_id,note) values(r.variant_id,'return_restock',r.quantity,'order',p_order_id::text,'Pre-fulfilment cancelled order restocked');
  end loop;
end $$;
revoke all on function public.restock_cancelled_order_inventory(bigint) from public;
grant execute on function public.restock_cancelled_order_inventory(bigint) to service_role;
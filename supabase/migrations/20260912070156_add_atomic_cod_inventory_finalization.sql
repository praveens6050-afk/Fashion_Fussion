create or replace function public.finalize_cod_order_inventory(
  p_order_id bigint,
  p_user_id uuid,
  p_source text default 'cod'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  r record;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'service role required';
  end if;
  select * into v_order from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_method <> 'cod' then raise exception 'Order is not COD'; end if;
  if v_order.status in ('cod_pending','cod_collected') then return; end if;
  if v_order.status not in ('creating','created') then raise exception 'Order cannot be finalized as COD'; end if;

  for r in
    select * from public.order_inventory_reservations
    where order_id=p_order_id and status='reserved'
    for update
  loop
    update public.inventory_levels
      set on_hand=on_hand-r.quantity,reserved=reserved-r.quantity,updated_at=now()
      where variant_id=r.variant_id and on_hand>=r.quantity and reserved>=r.quantity;
    if not found then raise exception 'Inventory commit mismatch for variant %',r.variant_id; end if;
    update public.order_inventory_reservations
      set status='committed',committed_at=now(),updated_at=now()
      where order_id=p_order_id and variant_id=r.variant_id;
    insert into public.inventory_movements(variant_id,movement_type,quantity_delta,reference_type,reference_id,note)
      values(r.variant_id,'order_commit',-r.quantity,'order',p_order_id::text,'COD inventory committed atomically');
  end loop;

  perform public.finalize_checkout_order(p_order_id,p_user_id,null,null,'cod_pending',coalesce(nullif(btrim(p_source),''),'cod'));
end;
$$;
revoke all on function public.finalize_cod_order_inventory(bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.finalize_cod_order_inventory(bigint,uuid,text) to service_role;
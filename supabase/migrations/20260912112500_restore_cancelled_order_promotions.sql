create or replace function public.restore_cancelled_order_promotions(p_order_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  o public.orders%rowtype;
  r public.promotion_reservations%rowtype;
begin
  select * into o
  from public.orders
  where id=p_order_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if coalesce(o.fulfillment_status,'') <> 'cancelled' then
    raise exception 'Order must be cancelled before promotions are restored';
  end if;

  for r in
    select * from public.promotion_reservations
    where order_id=p_order_id
      and user_id=p_user_id
      and status in ('reserved','consumed')
    for update
  loop
    if r.kind='coupon' and r.coupon_id is not null then
      delete from public.coupon_redemptions
      where coupon_id=r.coupon_id
        and user_id=p_user_id
        and order_id=p_order_id;

    elsif r.kind='gift_card' and r.gift_card_code_id is not null and coalesce(r.amount,0)>0 then
      update public.gift_card_codes
      set balance=balance+r.amount,
          updated_at=now()
      where id=r.gift_card_code_id;

      delete from public.gift_card_redemptions
      where gift_card_code_id=r.gift_card_code_id
        and user_id=p_user_id
        and order_id=p_order_id;
    end if;

    update public.promotion_reservations
    set status='released', updated_at=now()
    where id=r.id;
  end loop;
end;
$function$;

revoke all on function public.restore_cancelled_order_promotions(bigint,uuid) from public, anon, authenticated;
grant execute on function public.restore_cancelled_order_promotions(bigint,uuid) to service_role;

create or replace function public.finalize_cod_order_inventory(p_order_id bigint, p_user_id uuid, p_source text default 'cod'::text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_order public.orders%rowtype;
  r record;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'service role required';
  end if;

  select * into v_order
  from public.orders
  where id=p_order_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_method <> 'cod' then raise exception 'Order is not COD'; end if;
  if v_order.status in ('cod_pending','cod_collected') then return; end if;
  if v_order.status not in ('creating','created') then raise exception 'Order cannot be finalized as COD'; end if;

  -- Consume coupon/gift-card reservations when the COD order becomes final so
  -- usage limits and gift-card balances are authoritative while the order is active.
  perform public.finalize_order_promotions(v_order.id,p_user_id);

  for r in
    select * from public.order_inventory_reservations
    where order_id=p_order_id and status='reserved'
    for update
  loop
    update public.inventory_levels
      set on_hand=on_hand-r.quantity,
          reserved=reserved-r.quantity,
          updated_at=now()
      where variant_id=r.variant_id
        and on_hand>=r.quantity
        and reserved>=r.quantity;

    if not found then raise exception 'Inventory commit mismatch for variant %',r.variant_id; end if;

    update public.order_inventory_reservations
      set status='committed',committed_at=now(),updated_at=now()
      where order_id=p_order_id and variant_id=r.variant_id;

    insert into public.inventory_movements(variant_id,movement_type,quantity_delta,reference_type,reference_id,note)
      values(r.variant_id,'order_commit',-r.quantity,'order',p_order_id::text,'COD inventory committed atomically');
  end loop;

  perform public.finalize_checkout_order(
    p_order_id,p_user_id,null,null,'cod_pending',coalesce(nullif(btrim(p_source),''),'cod')
  );
end;
$function$;

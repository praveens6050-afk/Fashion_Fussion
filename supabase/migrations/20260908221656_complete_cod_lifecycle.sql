-- Applied to production as migration 20260908221656 complete_cod_lifecycle.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check(status in('creating','created','paid','cod_pending','cod_collected','cod_cancelled','payment_failed','expired','cancelled','refund_pending','refunded'));

create or replace function public.reserve_order_promotions(p_order_id bigint,p_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;c public.coupons%rowtype;g public.gift_card_codes%rowtype;used_count bigint;inserted_id bigint;begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status not in('creating','created') then raise exception 'Order is not reservable'; end if;
  if o.coupon_code is not null and coalesce(o.coupon_discount,0)>0 then
    select * into c from public.coupons where code=o.coupon_code for update;
    if not found or not c.is_active then raise exception 'Coupon is no longer valid'; end if;
    if c.starts_at>now() or(c.expires_at is not null and c.expires_at<=now()) then raise exception 'Coupon is not currently valid'; end if;
    if c.usage_limit is not null then
      select count(*) into used_count from public.coupon_redemptions where coupon_id=c.id;
      used_count:=used_count+(select count(*) from public.promotion_reservations where kind='coupon' and coupon_id=c.id and status='reserved');
      if used_count>=c.usage_limit then raise exception 'Coupon usage limit reached'; end if;
    end if;
    insert into public.promotion_reservations(order_id,user_id,kind,coupon_id,amount,expires_at)
    values(o.id,p_user_id,'coupon',c.id,o.coupon_discount,now()+interval '30 days') on conflict(order_id,kind) do nothing;
  end if;
  if o.gift_card_code is not null and coalesce(o.gift_card_discount,0)>0 then
    select * into g from public.gift_card_codes where code=o.gift_card_code for update;
    if not found or not g.is_active then raise exception 'Gift card is no longer valid'; end if;
    if g.expires_at is not null and g.expires_at<=now() then raise exception 'Gift card has expired'; end if;
    if g.balance<o.gift_card_discount then raise exception 'Gift card balance is insufficient'; end if;
    inserted_id:=null;
    insert into public.promotion_reservations(order_id,user_id,kind,gift_card_code_id,amount,expires_at)
    values(o.id,p_user_id,'gift_card',g.id,o.gift_card_discount,now()+interval '30 days')
    on conflict(order_id,kind) do nothing returning id into inserted_id;
    if inserted_id is not null then update public.gift_card_codes set balance=balance-o.gift_card_discount,updated_at=now() where id=g.id; end if;
  end if;
end$$;
revoke execute on function public.reserve_order_promotions(bigint,uuid) from public,anon,authenticated;
grant execute on function public.reserve_order_promotions(bigint,uuid) to service_role;

create or replace function public.finalize_checkout_order(p_order_id bigint,p_user_id uuid,p_payment_id text,p_payment_signature text,p_target_status text,p_source text)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_target_status not in('paid','cod_pending') then raise exception 'Invalid target status'; end if;
  if p_target_status='paid' and o.payment_method<>'prepaid' then raise exception 'Order is not prepaid'; end if;
  if p_target_status='cod_pending' and o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if p_target_status='paid' and o.total_amount>0 and nullif(trim(coalesce(p_payment_id,'')),'') is null then raise exception 'Payment ID is required'; end if;
  if o.status=p_target_status then return; end if;
  if o.status in('paid','cod_pending','cod_collected','refunded') then raise exception 'Order is already finalized'; end if;
  if p_target_status='paid' then perform public.finalize_order_promotions(o.id,p_user_id); end if;
  update public.orders set
    razorpay_payment_id=case when p_payment_id is not null then p_payment_id else razorpay_payment_id end,
    razorpay_signature=case when p_payment_signature is not null then p_payment_signature else razorpay_signature end,
    status=p_target_status,
    payment_verified_at=case when p_target_status='paid' then now() else payment_verified_at end,
    payment_source=nullif(trim(coalesce(p_source,'')),'')
  where id=o.id;
end$$;
revoke execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) to service_role;

create or replace function public.complete_cod_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true) then raise exception 'Admin access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if o.status='cod_collected' then return; end if;
  if o.status<>'cod_pending' then raise exception 'COD order is not pending collection'; end if;
  perform public.finalize_order_promotions(o.id,o.user_id);
  update public.orders set status='cod_collected',payment_verified_at=now(),payment_source='cod_collection' where id=o.id;
end$$;
revoke execute on function public.complete_cod_order(bigint) from public,anon;
grant execute on function public.complete_cod_order(bigint) to authenticated;

create or replace function public.cancel_cod_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true) then raise exception 'Admin access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if o.status='cod_cancelled' then return; end if;
  if o.status<>'cod_pending' then raise exception 'Only pending COD orders can be cancelled'; end if;
  perform public.release_order_promotions(o.id,o.user_id);
  update public.orders set status='cod_cancelled',fulfillment_status='cancelled',fulfillment_updated_at=now(),payment_source='cod_cancelled' where id=o.id;
end$$;
revoke execute on function public.cancel_cod_order(bigint) from public,anon;
grant execute on function public.cancel_cod_order(bigint) to authenticated;

create or replace function public.release_stale_checkout_orders()
returns integer language plpgsql security definer set search_path=''
as $$declare o record;released_count integer:=0;begin
  for o in select id,user_id,status from public.orders where(status='creating' and created_at<now()-interval '1 hour') or(status='created' and created_at<now()-interval '30 days') or status in('payment_failed','expired','cancelled') for update skip locked loop
    perform public.release_order_promotions(o.id,o.user_id);
    if o.status='creating' then update public.orders set status='payment_failed' where id=o.id;
    elsif o.status='created' then update public.orders set status='expired' where id=o.id;end if;
    released_count:=released_count+1;
  end loop;
  return released_count;
end$$;
revoke execute on function public.release_stale_checkout_orders() from public,anon,authenticated;
grant execute on function public.release_stale_checkout_orders() to service_role;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('release-stale-fashion-fussion-checkouts','17 * * * *','select public.release_stale_checkout_orders();');
notify pgrst,'reload schema';

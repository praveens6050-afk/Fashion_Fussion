alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('creating','created','paid','cod_pending','cod_collected','cod_cancelled','payment_failed','expired','cancelled','refund_pending','refunded'));

create or replace function public.finalize_checkout_order(
  p_order_id bigint,
  p_user_id uuid,
  p_payment_id text,
  p_payment_signature text,
  p_target_status text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_target_status not in ('paid','cod_pending') then raise exception 'Invalid target status'; end if;
  if p_target_status='paid' and o.payment_method<>'prepaid' then raise exception 'Order is not prepaid'; end if;
  if p_target_status='cod_pending' and o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if p_target_status='paid' and o.total_amount>0 and nullif(trim(coalesce(p_payment_id,'')),'') is null then raise exception 'Payment ID is required'; end if;

  if o.status=p_target_status then
    if p_target_status='paid' and p_payment_id is not null and o.razorpay_payment_id is not null and o.razorpay_payment_id<>p_payment_id then raise exception 'Order is linked to a different payment'; end if;
    return;
  end if;
  if o.status in ('paid','cod_pending','cod_collected','refunded') then raise exception 'Order is already finalized'; end if;

  if p_target_status='paid' then
    perform public.finalize_order_promotions(o.id,p_user_id);
  end if;

  update public.orders
  set razorpay_payment_id=case when p_payment_id is not null then p_payment_id else razorpay_payment_id end,
      razorpay_signature=case when p_payment_signature is not null then p_payment_signature else razorpay_signature end,
      status=p_target_status,
      payment_verified_at=case when p_target_status='paid' then now() else payment_verified_at end,
      payment_source=nullif(trim(coalesce(p_source,'')),'')
  where id=o.id;
end;
$$;
revoke execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) to service_role;

create or replace function public.complete_cod_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true) then raise exception 'Admin access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if o.status='cod_collected' then return; end if;
  if o.status<>'cod_pending' then raise exception 'COD order is not pending collection'; end if;
  perform public.finalize_order_promotions(o.id,o.user_id);
  update public.orders set status='cod_collected',payment_verified_at=now(),payment_source='cod_collection' where id=o.id;
end;
$$;
revoke execute on function public.complete_cod_order(bigint) from public,anon;
grant execute on function public.complete_cod_order(bigint) to authenticated;

create or replace function public.cancel_cod_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true) then raise exception 'Admin access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if o.status='cod_cancelled' then return; end if;
  if o.status<>'cod_pending' then raise exception 'Only pending COD orders can be cancelled'; end if;
  perform public.release_order_promotions(o.id,o.user_id);
  update public.orders set status='cod_cancelled',fulfillment_status='cancelled',fulfillment_updated_at=now(),payment_source='cod_cancelled' where id=o.id;
end;
$$;
revoke execute on function public.cancel_cod_order(bigint) from public,anon;
grant execute on function public.cancel_cod_order(bigint) to authenticated;

notify pgrst,'reload schema';
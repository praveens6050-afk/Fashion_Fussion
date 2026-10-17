begin;

alter table public.orders
  add column if not exists payment_method text not null default 'prepaid',
  add column if not exists payment_handling_fee numeric not null default 0,
  add column if not exists prepaid_discount numeric not null default 0,
  add column if not exists cod_fee_non_refundable boolean not null default false,
  add column if not exists checkout_key text,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_source text;

alter table public.orders alter column status set default 'creating';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='orders_payment_method_check') then
    alter table public.orders add constraint orders_payment_method_check check (payment_method in ('prepaid','cod'));
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_payment_handling_fee_check') then
    alter table public.orders add constraint orders_payment_handling_fee_check check (payment_handling_fee >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_prepaid_discount_check') then
    alter table public.orders add constraint orders_prepaid_discount_check check (prepaid_discount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_status_check') then
    alter table public.orders add constraint orders_status_check check (status in ('creating','created','paid','cod_pending','payment_failed','expired','cancelled','refund_pending','refunded'));
  end if;
end $$;

create unique index if not exists orders_user_checkout_key_uidx
  on public.orders(user_id, checkout_key)
  where checkout_key is not null;
create index if not exists orders_status_created_at_idx
  on public.orders(status, created_at);

create unique index if not exists customer_addresses_one_default_uidx
  on public.customer_addresses(user_id)
  where is_default is true;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='customer_wishlist_product_id_fkey') then
    alter table public.customer_wishlist
      add constraint customer_wishlist_product_id_fkey
      foreign key (product_id) references public.products(id) on delete cascade;
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '')
  )
  on conflict (id) do update
    set full_name = case when coalesce(public.profiles.full_name,'') = '' then excluded.full_name else public.profiles.full_name end,
        phone = coalesce(public.profiles.phone, excluded.phone);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role, supabase_auth_admin;

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own non-admin profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id and is_admin = false);

drop policy if exists "Authenticated can update permitted support requests" on public.customer_support_requests;
drop policy if exists "Admins can update support requests" on public.customer_support_requests;
create policy "Admins can update support requests"
on public.customer_support_requests for update
to authenticated
using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true))
with check (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true));

create or replace function public.admin_product_costs()
returns table(product_id bigint, cost numeric)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.cost
  from public.products p
  where exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.is_admin = true
  )
  order by p.id;
$$;
revoke execute on function public.admin_product_costs() from public, anon;
grant execute on function public.admin_product_costs() to authenticated;

create or replace function public.release_order_promotions(p_order_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not exists(select 1 from public.orders where id=p_order_id and user_id=p_user_id) then
    raise exception 'Order not found';
  end if;

  for r in
    select * from public.promotion_reservations
    where order_id=p_order_id and user_id=p_user_id and status='reserved'
    for update
  loop
    if r.kind='gift_card' and r.gift_card_code_id is not null and r.amount>0 then
      update public.gift_card_codes
      set balance=balance+r.amount, updated_at=now()
      where id=r.gift_card_code_id;
    end if;

    update public.promotion_reservations
    set status='released', updated_at=now()
    where id=r.id;
  end loop;
end;
$$;
revoke execute on function public.release_order_promotions(bigint,uuid) from public, anon, authenticated;
grant execute on function public.release_order_promotions(bigint,uuid) to service_role;

create or replace function public.reserve_order_promotions(p_order_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  c public.coupons%rowtype;
  g public.gift_card_codes%rowtype;
  used_count bigint;
  inserted_id bigint;
begin
  select * into o
  from public.orders
  where id=p_order_id and user_id=p_user_id
  for update;
  if not found then raise exception 'Order not found'; end if;

  if o.status not in ('creating','created') then
    raise exception 'Order is not reservable';
  end if;

  if o.coupon_code is not null and coalesce(o.coupon_discount,0)>0 then
    select * into c from public.coupons where code=o.coupon_code for update;
    if not found or not c.is_active then raise exception 'Coupon is no longer valid'; end if;
    if c.starts_at>now() or (c.expires_at is not null and c.expires_at<=now()) then
      raise exception 'Coupon is not currently valid';
    end if;
    if c.usage_limit is not null then
      select count(*) into used_count from public.coupon_redemptions where coupon_id=c.id;
      used_count:=used_count+(select count(*) from public.promotion_reservations where kind='coupon' and coupon_id=c.id and status='reserved');
      if used_count>=c.usage_limit then raise exception 'Coupon usage limit reached'; end if;
    end if;
    insert into public.promotion_reservations(order_id,user_id,kind,coupon_id,amount,expires_at)
    values(o.id,p_user_id,'coupon',c.id,o.coupon_discount,now()+interval '30 days')
    on conflict(order_id,kind) do nothing;
  end if;

  if o.gift_card_code is not null and coalesce(o.gift_card_discount,0)>0 then
    select * into g from public.gift_card_codes where code=o.gift_card_code for update;
    if not found or not g.is_active then raise exception 'Gift card is no longer valid'; end if;
    if g.expires_at is not null and g.expires_at<=now() then raise exception 'Gift card has expired'; end if;
    if g.balance<o.gift_card_discount then raise exception 'Gift card balance is insufficient'; end if;

    inserted_id:=null;
    insert into public.promotion_reservations(order_id,user_id,kind,gift_card_code_id,amount,expires_at)
    values(o.id,p_user_id,'gift_card',g.id,o.gift_card_discount,now()+interval '30 days')
    on conflict(order_id,kind) do nothing
    returning id into inserted_id;

    if inserted_id is not null then
      update public.gift_card_codes
      set balance=balance-o.gift_card_discount, updated_at=now()
      where id=g.id;
    end if;
  end if;
end;
$$;
revoke execute on function public.reserve_order_promotions(bigint,uuid) from public, anon, authenticated;
grant execute on function public.reserve_order_promotions(bigint,uuid) to service_role;

create or replace function public.finalize_order_promotions(p_order_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  r public.promotion_reservations%rowtype;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Order not found'; end if;

  if coalesce(o.coupon_discount,0)>0 then
    select * into r from public.promotion_reservations
    where order_id=o.id and user_id=p_user_id and kind='coupon' for update;
    if not found or r.status='released' then raise exception 'Coupon reservation is missing or released'; end if;
    if r.status='reserved' then
      insert into public.coupon_redemptions(coupon_id,user_id,order_id,discount_amount)
      values(r.coupon_id,p_user_id,o.id,r.amount)
      on conflict (coupon_id,order_id) where order_id is not null do nothing;
      update public.promotion_reservations set status='consumed',updated_at=now() where id=r.id;
    end if;
  end if;

  if coalesce(o.gift_card_discount,0)>0 then
    select * into r from public.promotion_reservations
    where order_id=o.id and user_id=p_user_id and kind='gift_card' for update;
    if not found or r.status='released' then raise exception 'Gift card reservation is missing or released'; end if;
    if r.status='reserved' then
      insert into public.gift_card_redemptions(gift_card_code_id,user_id,order_id,amount)
      values(r.gift_card_code_id,p_user_id,o.id,r.amount)
      on conflict (gift_card_code_id,order_id) where order_id is not null do nothing;
      update public.promotion_reservations set status='consumed',updated_at=now() where id=r.id;
    end if;
  end if;
end;
$$;
revoke execute on function public.finalize_order_promotions(bigint,uuid) from public, anon, authenticated;
grant execute on function public.finalize_order_promotions(bigint,uuid) to service_role;

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
  if p_target_status='paid' and o.total_amount>0 and nullif(trim(coalesce(p_payment_id,'')),'') is null then
    raise exception 'Payment ID is required';
  end if;

  if o.status=p_target_status then
    if p_target_status='paid' and p_payment_id is not null and o.razorpay_payment_id is not null and o.razorpay_payment_id<>p_payment_id then
      raise exception 'Order is linked to a different payment';
    end if;
    return;
  end if;

  if o.status in ('paid','cod_pending','refunded') then
    raise exception 'Order is already finalized';
  end if;

  perform public.finalize_order_promotions(o.id,p_user_id);

  update public.orders
  set razorpay_payment_id = case when p_payment_id is not null then p_payment_id else razorpay_payment_id end,
      razorpay_signature = case when p_payment_signature is not null then p_payment_signature else razorpay_signature end,
      status = p_target_status,
      payment_verified_at = now(),
      payment_source = nullif(trim(coalesce(p_source,'')),'')
  where id=o.id;
end;
$$;
revoke execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) to service_role;

create or replace function public.release_stale_checkout_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  released_count integer:=0;
begin
  for o in
    select id,user_id,status from public.orders
    where (status='creating' and created_at<now()-interval '1 hour')
       or (status='created' and created_at<now()-interval '30 days')
       or status in ('payment_failed','expired','cancelled')
    for update skip locked
  loop
    perform public.release_order_promotions(o.id,o.user_id);
    if o.status='creating' then
      update public.orders set status='payment_failed' where id=o.id;
    elsif o.status='created' then
      update public.orders set status='expired' where id=o.id;
    end if;
    released_count:=released_count+1;
  end loop;
  return released_count;
end;
$$;
revoke execute on function public.release_stale_checkout_orders() from public, anon, authenticated;
grant execute on function public.release_stale_checkout_orders() to service_role;

revoke execute on function public.generate_display_order_id() from public, anon, authenticated;
grant execute on function public.generate_display_order_id() to service_role;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('release-stale-fashion-fussion-checkouts','17 * * * *','select public.release_stale_checkout_orders();');

notify pgrst, 'reload schema';
commit;
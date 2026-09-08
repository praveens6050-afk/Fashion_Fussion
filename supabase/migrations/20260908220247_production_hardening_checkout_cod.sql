-- Applied to production as migration 20260908220247 production_hardening_checkout_cod.
-- This file is source control for the production migration; do not edit an applied migration.

alter table public.orders
  add column if not exists payment_method text not null default 'prepaid',
  add column if not exists payment_handling_fee numeric not null default 0,
  add column if not exists prepaid_discount numeric not null default 0,
  add column if not exists cod_fee_non_refundable boolean not null default false,
  add column if not exists checkout_key text,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_source text;

alter table public.orders alter column status set default 'creating';

create unique index if not exists orders_user_checkout_key_uidx on public.orders(user_id,checkout_key) where checkout_key is not null;
create index if not exists orders_status_created_at_idx on public.orders(status,created_at);
create unique index if not exists customer_addresses_one_default_uidx on public.customer_addresses(user_id) where is_default is true;

alter table public.customer_wishlist drop constraint if exists customer_wishlist_product_id_fkey;
alter table public.customer_wishlist add constraint customer_wishlist_product_id_fkey foreign key(product_id) references public.products(id) on delete cascade;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.profiles(id,full_name,phone)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),nullif(trim(coalesce(new.raw_user_meta_data->>'phone','')),''))
  on conflict(id) do update set
    full_name=case when coalesce(public.profiles.full_name,'')='' then excluded.full_name else public.profiles.full_name end,
    phone=coalesce(public.profiles.phone,excluded.phone);
  return new;
end;$$;
revoke execute on function public.handle_new_user() from public,anon,authenticated;
grant execute on function public.handle_new_user() to service_role,supabase_auth_admin;

drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can insert own non-admin profile" on public.profiles;
create policy "Users can insert own non-admin profile" on public.profiles for insert to authenticated
with check((select auth.uid())=id and is_admin=false);

drop policy if exists "Authenticated can update permitted support requests" on public.customer_support_requests;
drop policy if exists "Admins can update support requests" on public.customer_support_requests;
create policy "Admins can update support requests" on public.customer_support_requests for update to authenticated
using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true))
with check(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true));

create or replace function public.admin_product_costs()
returns table(product_id bigint,cost numeric)
language sql security definer set search_path=''
as $$select p.id,p.cost from public.products p where exists(select 1 from public.profiles pr where pr.id=auth.uid() and pr.is_admin=true) order by p.id$$;
revoke execute on function public.admin_product_costs() from public,anon;
grant execute on function public.admin_product_costs() to authenticated;

create or replace function public.release_order_promotions(p_order_id bigint,p_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$declare r record;begin
  if not exists(select 1 from public.orders where id=p_order_id and user_id=p_user_id) then raise exception 'Order not found'; end if;
  for r in select * from public.promotion_reservations where order_id=p_order_id and user_id=p_user_id and status='reserved' for update loop
    if r.kind='gift_card' and r.gift_card_code_id is not null and r.amount>0 then
      update public.gift_card_codes set balance=balance+r.amount,updated_at=now() where id=r.gift_card_code_id;
    end if;
    update public.promotion_reservations set status='released',updated_at=now() where id=r.id;
  end loop;
end$$;
revoke execute on function public.release_order_promotions(bigint,uuid) from public,anon,authenticated;
grant execute on function public.release_order_promotions(bigint,uuid) to service_role;

create or replace function public.finalize_order_promotions(p_order_id bigint,p_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;r public.promotion_reservations%rowtype;begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Order not found'; end if;
  if coalesce(o.coupon_discount,0)>0 then
    select * into r from public.promotion_reservations where order_id=o.id and user_id=p_user_id and kind='coupon' for update;
    if not found or r.status='released' then raise exception 'Coupon reservation is missing or released'; end if;
    if r.status='reserved' then
      insert into public.coupon_redemptions(coupon_id,user_id,order_id,discount_amount) values(r.coupon_id,p_user_id,o.id,r.amount)
      on conflict(coupon_id,order_id) where order_id is not null do nothing;
      update public.promotion_reservations set status='consumed',updated_at=now() where id=r.id;
    end if;
  end if;
  if coalesce(o.gift_card_discount,0)>0 then
    select * into r from public.promotion_reservations where order_id=o.id and user_id=p_user_id and kind='gift_card' for update;
    if not found or r.status='released' then raise exception 'Gift card reservation is missing or released'; end if;
    if r.status='reserved' then
      insert into public.gift_card_redemptions(gift_card_code_id,user_id,order_id,amount) values(r.gift_card_code_id,p_user_id,o.id,r.amount)
      on conflict(gift_card_code_id,order_id) where order_id is not null do nothing;
      update public.promotion_reservations set status='consumed',updated_at=now() where id=r.id;
    end if;
  end if;
end$$;
revoke execute on function public.finalize_order_promotions(bigint,uuid) from public,anon,authenticated;
grant execute on function public.finalize_order_promotions(bigint,uuid) to service_role;

-- reserve_order_promotions, finalize_checkout_order and stale cleanup are defined by subsequent production migrations in this directory.

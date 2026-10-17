create table if not exists public.promotion_reservations (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('coupon','gift_card')),
  coupon_id bigint references public.coupons(id) on delete restrict,
  gift_card_code_id bigint references public.gift_card_codes(id) on delete restrict,
  amount numeric not null check(amount >= 0),
  status text not null default 'reserved' check(status in ('reserved','consumed','released')),
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,kind)
);
alter table public.promotion_reservations enable row level security;

create or replace function public.reserve_order_promotions(p_order_id bigint,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
 o public.orders%rowtype;
 c public.coupons%rowtype;
 g public.gift_card_codes%rowtype;
 r record;
 used_count bigint;
 inserted_id bigint;
begin
 for r in select * from public.promotion_reservations where status='reserved' and expires_at<=now() for update skip locked loop
   if r.kind='gift_card' and r.gift_card_code_id is not null and r.amount>0 then
     update public.gift_card_codes set balance=balance+r.amount,updated_at=now() where id=r.gift_card_code_id;
   end if;
   update public.promotion_reservations set status='released',updated_at=now() where id=r.id;
 end loop;

 select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'Order not found'; end if;

 if o.coupon_code is not null and coalesce(o.coupon_discount,0)>0 then
   select * into c from public.coupons where code=o.coupon_code for update;
   if not found or not c.is_active then raise exception 'Coupon is no longer valid'; end if;
   if c.starts_at>now() or (c.expires_at is not null and c.expires_at<=now()) then raise exception 'Coupon is not currently valid'; end if;
   if c.usage_limit is not null then
     select count(*) into used_count from public.coupon_redemptions where coupon_id=c.id;
     used_count:=used_count+(select count(*) from public.promotion_reservations where kind='coupon' and coupon_id=c.id and status='reserved' and expires_at>now());
     if used_count>=c.usage_limit then raise exception 'Coupon usage limit reached'; end if;
   end if;
   insert into public.promotion_reservations(order_id,user_id,kind,coupon_id,amount)
   values(o.id,p_user_id,'coupon',c.id,o.coupon_discount)
   on conflict(order_id,kind) do nothing;
 end if;

 if o.gift_card_code is not null and coalesce(o.gift_card_discount,0)>0 then
   select * into g from public.gift_card_codes where code=o.gift_card_code for update;
   if not found or not g.is_active then raise exception 'Gift card is no longer valid'; end if;
   if g.expires_at is not null and g.expires_at<=now() then raise exception 'Gift card has expired'; end if;
   if g.balance<o.gift_card_discount then raise exception 'Gift card balance is insufficient'; end if;
   insert into public.promotion_reservations(order_id,user_id,kind,gift_card_code_id,amount)
   values(o.id,p_user_id,'gift_card',g.id,o.gift_card_discount)
   on conflict(order_id,kind) do nothing returning id into inserted_id;
   if inserted_id is not null then
     update public.gift_card_codes set balance=balance-o.gift_card_discount,updated_at=now() where id=g.id;
   end if;
 end if;
end $$;

create or replace function public.finalize_order_promotions(p_order_id bigint,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
 r record;
begin
 for r in select * from public.promotion_reservations where order_id=p_order_id and user_id=p_user_id and status='reserved' for update loop
   if r.expires_at<=now() then raise exception 'Promotion reservation expired'; end if;
   if r.kind='coupon' then
     insert into public.coupon_redemptions(coupon_id,user_id,order_id,amount)
     values(r.coupon_id,p_user_id,p_order_id,r.amount)
     on conflict(coupon_id,order_id) do nothing;
   elsif r.kind='gift_card' then
     insert into public.gift_card_redemptions(gift_card_code_id,user_id,order_id,amount)
     values(r.gift_card_code_id,p_user_id,p_order_id,r.amount)
     on conflict(gift_card_code_id,order_id) where order_id is not null do nothing;
   end if;
   update public.promotion_reservations set status='consumed',updated_at=now() where id=r.id;
 end loop;
end $$;

revoke all on function public.reserve_order_promotions(bigint,uuid) from public,anon,authenticated;
revoke all on function public.finalize_order_promotions(bigint,uuid) from public,anon,authenticated;
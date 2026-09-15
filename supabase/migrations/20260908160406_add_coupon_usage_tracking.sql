create table if not exists public.coupon_redemptions (
 id bigint generated always as identity primary key,
 coupon_id bigint not null references public.coupons(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 order_id bigint references public.orders(id) on delete set null,
 discount_amount numeric not null check(discount_amount >= 0),
 created_at timestamptz not null default now()
);
alter table public.coupon_redemptions enable row level security;
create policy "Users can view own coupon redemptions" on public.coupon_redemptions for select to authenticated using(auth.uid()=user_id);
create policy "Admins can view coupon redemptions" on public.coupon_redemptions for select to authenticated using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));
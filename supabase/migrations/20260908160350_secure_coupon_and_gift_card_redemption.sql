alter table public.orders add column if not exists coupon_code text, add column if not exists coupon_discount numeric not null default 0, add column if not exists gift_card_code text, add column if not exists gift_card_discount numeric not null default 0;

create table if not exists public.gift_card_codes (
 id bigint generated always as identity primary key,
 gift_card_id bigint references public.gift_cards(id) on delete set null,
 code text not null unique,
 initial_balance numeric not null check(initial_balance > 0),
 balance numeric not null check(balance >= 0),
 expires_at timestamptz,
 is_active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.gift_card_codes enable row level security;
create policy "Admins can manage gift card codes" on public.gift_card_codes for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true)) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

create table if not exists public.gift_card_redemptions (
 id bigint generated always as identity primary key,
 gift_card_code_id bigint not null references public.gift_card_codes(id),
 user_id uuid not null references auth.users(id),
 order_id bigint references public.orders(id) on delete set null,
 amount numeric not null check(amount > 0),
 created_at timestamptz not null default now()
);
alter table public.gift_card_redemptions enable row level security;
create policy "Users can view own gift card redemptions" on public.gift_card_redemptions for select to authenticated using(auth.uid()=user_id);
create policy "Admins can view gift card redemptions" on public.gift_card_redemptions for select to authenticated using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));
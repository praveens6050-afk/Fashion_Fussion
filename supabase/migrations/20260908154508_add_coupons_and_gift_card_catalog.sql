create table if not exists public.coupons (
  id bigint generated always as identity primary key,
  code text not null unique,
  title text not null,
  description text,
  discount_type text not null check (discount_type in ('percent','flat')),
  discount_value numeric not null check (discount_value > 0),
  min_order_amount numeric not null default 0 check (min_order_amount >= 0),
  max_discount numeric,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  usage_limit integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_cards (
  id bigint generated always as identity primary key,
  title text not null,
  amount numeric not null check (amount > 0),
  description text,
  validity_days integer not null default 365 check (validity_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coupons enable row level security;
alter table public.gift_cards enable row level security;

create policy "Customers can view active coupons"
on public.coupons for select
to authenticated
using (
  is_active = true
  and starts_at <= now()
  and (expires_at is null or expires_at > now())
);

create policy "Admins can manage coupons"
on public.coupons for all
to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
);

create policy "Customers can view active gift cards"
on public.gift_cards for select
to authenticated
using (is_active = true);

create policy "Admins can manage gift cards"
on public.gift_cards for all
to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
);

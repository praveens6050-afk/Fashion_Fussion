create table if not exists public.customer_addresses (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  full_name text not null,
  phone text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'India',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_addresses enable row level security;

drop policy if exists "Customers can view own addresses" on public.customer_addresses;
create policy "Customers can view own addresses" on public.customer_addresses for select to authenticated using (user_id = auth.uid());

drop policy if exists "Customers can insert own addresses" on public.customer_addresses;
create policy "Customers can insert own addresses" on public.customer_addresses for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Customers can update own addresses" on public.customer_addresses;
create policy "Customers can update own addresses" on public.customer_addresses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Customers can delete own addresses" on public.customer_addresses;
create policy "Customers can delete own addresses" on public.customer_addresses for delete to authenticated using (user_id = auth.uid());

create index if not exists customer_addresses_user_id_idx on public.customer_addresses(user_id);
alter table public.orders add column if not exists shipping_address jsonb;
create index if not exists orders_user_id_created_at_idx on public.orders(user_id, created_at desc);
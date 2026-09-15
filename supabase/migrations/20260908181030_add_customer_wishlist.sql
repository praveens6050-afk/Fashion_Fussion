create table if not exists public.customer_wishlist (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null,
  created_at timestamptz not null default now(),
  unique(user_id, product_id)
);
alter table public.customer_wishlist enable row level security;
drop policy if exists "wishlist_select_own" on public.customer_wishlist;
create policy "wishlist_select_own" on public.customer_wishlist for select to authenticated using (auth.uid() = user_id);
drop policy if exists "wishlist_insert_own" on public.customer_wishlist;
create policy "wishlist_insert_own" on public.customer_wishlist for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "wishlist_delete_own" on public.customer_wishlist;
create policy "wishlist_delete_own" on public.customer_wishlist for delete to authenticated using (auth.uid() = user_id);
grant select, insert, delete on public.customer_wishlist to authenticated;
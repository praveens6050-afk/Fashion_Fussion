drop policy if exists "Public can view active products" on public.products;
drop policy if exists "Admins can view all products" on public.products;
drop policy if exists "Anon can view active products" on public.products;
drop policy if exists "Authenticated can view products" on public.products;
create policy "Anon can view active products" on public.products for select to anon using(is_active=true);
create policy "Authenticated can view products" on public.products for select to authenticated using(is_active=true or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true));
create index if not exists customer_wishlist_product_id_idx on public.customer_wishlist(product_id);
notify pgrst,'reload schema';

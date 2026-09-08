-- Keeps public active catalog reads independent from the admin profile check.
drop policy if exists "Public can view active products" on public.products;
drop policy if exists "Admins can view all products" on public.products;
create policy "Public can view active products" on public.products for select to anon,authenticated using(is_active=true);
create policy "Admins can view all products" on public.products for select to authenticated using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true));
notify pgrst,'reload schema';

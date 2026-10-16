do $split_product_select_policies$
begin
  if to_regclass('public.products') is not null then
    execute 'drop policy if exists "Public can view active products" on public.products';
    execute 'drop policy if exists "Admins can view all products" on public.products';
    execute 'create policy "Public can view active products" on public.products for select to anon,authenticated using (is_active=true)';
    execute 'create policy "Admins can view all products" on public.products for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true))';
  end if;
end;
$split_product_select_policies$;
notify pgrst,'reload schema';

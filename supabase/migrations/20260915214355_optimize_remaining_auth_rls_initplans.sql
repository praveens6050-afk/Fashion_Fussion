begin;

alter policy business_profiles_select_own on public.business_profiles using ((select auth.uid()) = user_id);
alter policy business_profiles_insert_own on public.business_profiles with check ((select auth.uid()) = user_id);
alter policy business_profiles_update_own on public.business_profiles using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter policy bulk_quotes_select_own on public.bulk_quotes using ((select auth.uid()) = user_id);
alter policy bulk_quotes_insert_own on public.bulk_quotes with check ((select auth.uid()) = user_id);
alter policy bulk_quotes_admin_select on public.bulk_quotes using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy bulk_quotes_admin_update on public.bulk_quotes using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));

alter policy bulk_quote_items_select_own on public.bulk_quote_items using (exists (select 1 from public.bulk_quotes q where q.id = bulk_quote_items.quote_id and q.user_id = (select auth.uid())));
alter policy bulk_quote_items_insert_own on public.bulk_quote_items with check (exists (select 1 from public.bulk_quotes q where q.id = bulk_quote_items.quote_id and q.user_id = (select auth.uid())));
alter policy bulk_quote_items_admin_select on public.bulk_quote_items using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy bulk_quote_items_admin_update on public.bulk_quote_items using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));

alter policy product_variants_authenticated_read on public.product_variants using (((is_active = true) and exists (select 1 from public.products p where p.id = product_variants.product_id and p.is_active = true)) or exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));
alter policy product_variants_admin_insert on public.product_variants with check (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));
alter policy product_variants_admin_update on public.product_variants using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true)) with check (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));
alter policy product_variants_admin_delete on public.product_variants using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));

alter policy inventory_levels_admin_all on public.inventory_levels using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true)) with check (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));
alter policy inventory_movements_admin_select on public.inventory_movements using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));
alter policy inventory_movements_admin_insert on public.inventory_movements with check (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));
alter policy order_inventory_reservations_admin_select on public.order_inventory_reservations using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true));

commit;

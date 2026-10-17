drop policy if exists bulk_quotes_admin_select on public.bulk_quotes;
create policy bulk_quotes_admin_select on public.bulk_quotes
for select to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

drop policy if exists bulk_quotes_admin_update on public.bulk_quotes;
create policy bulk_quotes_admin_update on public.bulk_quotes
for update to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

drop policy if exists bulk_quote_items_admin_select on public.bulk_quote_items;
create policy bulk_quote_items_admin_select on public.bulk_quote_items
for select to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

drop policy if exists bulk_quote_items_admin_update on public.bulk_quote_items;
create policy bulk_quote_items_admin_update on public.bulk_quote_items
for update to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

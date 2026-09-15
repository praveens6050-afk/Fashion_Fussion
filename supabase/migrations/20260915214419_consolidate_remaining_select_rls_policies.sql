begin;

drop policy if exists bulk_quotes_select_own on public.bulk_quotes;
drop policy if exists bulk_quotes_admin_select on public.bulk_quotes;
create policy bulk_quotes_select_owner_or_admin
on public.bulk_quotes
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin = true
  )
);

drop policy if exists bulk_quote_items_select_own on public.bulk_quote_items;
drop policy if exists bulk_quote_items_admin_select on public.bulk_quote_items;
create policy bulk_quote_items_select_owner_or_admin
on public.bulk_quote_items
for select
to authenticated
using (
  exists (
    select 1 from public.bulk_quotes q
    where q.id = bulk_quote_items.quote_id
      and q.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin = true
  )
);

drop policy if exists "Customers can view own return requests" on public.return_requests;
drop policy if exists "Admins can view return requests" on public.return_requests;
create policy return_requests_select_owner_or_admin
on public.return_requests
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin = true
  )
);

commit;
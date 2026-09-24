begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.current_user_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_admin = true
  );
$$;

create or replace function private.current_user_is_customer_care()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.staff_access s
    where s.user_id = (select auth.uid())
      and s.role = 'customer_care'
      and s.status = 'active'
  );
$$;

revoke all on function private.current_user_is_owner() from public, anon;
revoke all on function private.current_user_is_customer_care() from public, anon;
grant execute on function private.current_user_is_owner() to authenticated, service_role;
grant execute on function private.current_user_is_customer_care() to authenticated, service_role;

drop policy if exists staff_access_owner_select on public.staff_access;
create policy staff_access_owner_select
on public.staff_access for select to authenticated
using (private.current_user_is_owner());

drop policy if exists staff_access_owner_insert on public.staff_access;
create policy staff_access_owner_insert
on public.staff_access for insert to authenticated
with check (private.current_user_is_owner());

drop policy if exists staff_access_owner_update on public.staff_access;
create policy staff_access_owner_update
on public.staff_access for update to authenticated
using (private.current_user_is_owner())
with check (private.current_user_is_owner());

drop policy if exists staff_access_owner_delete on public.staff_access;
create policy staff_access_owner_delete
on public.staff_access for delete to authenticated
using (private.current_user_is_owner());

drop policy if exists support_tickets_select_permitted on public.support_tickets;
create policy support_tickets_select_permitted
on public.support_tickets for select to authenticated
using (
  customer_id = (select auth.uid())
  or private.current_user_is_owner()
  or (channel = 'customer_support' and private.current_user_is_customer_care())
  or (
    channel = 'seller_support'
    and seller_id = (select auth.uid())
    and exists (
      select 1 from public.seller_profiles s
      where s.user_id = (select auth.uid())
        and s.status = 'active'
    )
  )
);

drop policy if exists support_messages_select_permitted on public.support_ticket_messages;
create policy support_messages_select_permitted
on public.support_ticket_messages for select to authenticated
using (
  exists (
    select 1
    from public.support_tickets t
    where t.id = support_ticket_messages.ticket_id
      and (
        t.customer_id = (select auth.uid())
        or private.current_user_is_owner()
        or (t.channel = 'customer_support' and private.current_user_is_customer_care())
        or (
          t.channel = 'seller_support'
          and t.seller_id = (select auth.uid())
          and exists (
            select 1 from public.seller_profiles s
            where s.user_id = (select auth.uid())
              and s.status = 'active'
          )
        )
      )
  )
);

notify pgrst, 'reload schema';
commit;

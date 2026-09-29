-- Recovery bundle reconstructed from production supabase_migrations.schema_migrations.
-- It replays the lost 20260921172418..20260924083918 migrations in their original order.

-- BEGIN RECOVERED 20260921172418_product_image_upload_storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/*']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Active sellers upload product images" on storage.objects;
create policy "Active sellers upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = 'seller'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1
    from public.seller_profiles sp
    where sp.user_id = (select auth.uid())
      and sp.status = 'active'
  )
);

drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = 'admin'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_admin = true
  )
);
-- END RECOVERED 20260921172418

-- BEGIN RECOVERED 20260922163337_remove_redundant_order_shipments_browser_deny_policy
drop policy if exists "Browser roles denied order shipments" on public.order_shipments;
-- END RECOVERED 20260922163337

-- BEGIN RECOVERED 20260922164010_restrict_internal_auth_helper_execute
revoke execute on function public.is_owner_user(uuid) from public, anon, authenticated;
revoke execute on function public.is_customer_care_user(uuid) from public, anon, authenticated;
grant execute on function public.is_owner_user(uuid) to service_role;
grant execute on function public.is_customer_care_user(uuid) to service_role;
-- END RECOVERED 20260922164010

-- BEGIN RECOVERED 20260923135809_fix_admin_cod_cancellation_resources
create or replace function public.cancel_cod_order_service(p_order_id bigint, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  o public.orders%rowtype;
begin
  if not exists(
    select 1 from public.profiles p
    where p.id = p_admin_id and p.is_admin = true
  ) then
    raise exception 'Admin access required';
  end if;

  select * into o
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if o.payment_method <> 'cod' then raise exception 'Order is not COD'; end if;
  if o.status = 'cod_cancelled' then return; end if;
  if o.status <> 'cod_pending' then raise exception 'Only pending COD orders can be cancelled'; end if;

  perform public.release_order_inventory(o.id);
  perform public.restock_cancelled_order_inventory(o.id);

  update public.orders
  set status = 'cod_cancelled',
      fulfillment_status = 'cancelled',
      fulfillment_updated_at = now(),
      payment_source = 'cod_cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      cancellation_reason = coalesce(nullif(btrim(cancellation_reason), ''), 'Cancelled by administrator')
  where id = o.id;

  perform public.restore_cancelled_order_promotions(o.id, o.user_id);
end;
$function$;
-- END RECOVERED 20260923135809

-- BEGIN RECOVERED 20260923141945_admin_login_rate_limit
create table if not exists private.admin_login_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on table private.admin_login_rate_limits from public, anon, authenticated;

create or replace function public.consume_admin_login_rate_limit(
  p_key text,
  p_limit integer default 8,
  p_window_seconds integer default 600
)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path to 'pg_catalog', 'private'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_row private.admin_login_rate_limits%rowtype;
  v_reset_at timestamptz;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'service role required';
  end if;
  if p_key is null or length(btrim(p_key)) < 3 or length(p_key) > 160 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'invalid rate limit'; end if;
  if p_window_seconds < 30 or p_window_seconds > 86400 then raise exception 'invalid rate limit window'; end if;

  insert into private.admin_login_rate_limits(rate_key, window_started_at, attempts, updated_at)
  values (p_key, v_now, 0, v_now)
  on conflict (rate_key) do nothing;

  select * into v_row
  from private.admin_login_rate_limits
  where rate_key = p_key
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, 0, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  v_reset_at := v_row.window_started_at + make_interval(secs => p_window_seconds);
  if v_now >= v_reset_at then
    v_row.window_started_at := v_now;
    v_row.attempts := 0;
    v_row.blocked_until := null;
    v_reset_at := v_now + make_interval(secs => p_window_seconds);
  end if;

  v_row.attempts := v_row.attempts + 1;

  if v_row.attempts > p_limit then
    update private.admin_login_rate_limits
    set attempts = v_row.attempts,
        blocked_until = v_reset_at,
        updated_at = v_now
    where rate_key = p_key;
    return query select false, 0, greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer);
    return;
  end if;

  update private.admin_login_rate_limits
  set window_started_at = v_row.window_started_at,
      attempts = v_row.attempts,
      blocked_until = null,
      updated_at = v_now
  where rate_key = p_key;

  return query select true, greatest(0, p_limit - v_row.attempts), 0;
end;
$function$;

revoke all on function public.consume_admin_login_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_admin_login_rate_limit(text, integer, integer) to service_role;
-- END RECOVERED 20260923141945

-- BEGIN RECOVERED 20260924083918_fix_support_rls_helper_permissions
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
-- END RECOVERED 20260924083918

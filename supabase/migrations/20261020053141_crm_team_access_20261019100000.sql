-- CRM team access: additive, branch-only migration. Do not apply remotely without approval.
-- Staff accounts must first be invited/created in Supabase Auth by an authorized operator.
-- Then an admin grants access by inserting the Auth user UUID and role into crm_team_members.

create table if not exists public.crm_team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  role text not null check (role in ('customer_support','seller_support','sales','marketing')),
  is_active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_team_members add column if not exists email text;
-- Keep legacy rows migratable; login still requires an exact email match.
alter table public.crm_team_members enable row level security;
revoke all on public.crm_team_members from anon, authenticated;
grant select, insert, update, delete on public.crm_team_members to authenticated;

create or replace function public.is_crm_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin is true
  ) or exists (
    select 1 from public.crm_team_members m
    where m.user_id = (select auth.uid()) and m.is_active is true and m.role in ('sales','marketing')
  );
$$;
revoke all on function public.is_crm_staff() from public, anon;
grant execute on function public.is_crm_staff() to authenticated;

drop policy if exists crm_team_members_admin_manage on public.crm_team_members;
create policy crm_team_members_admin_manage on public.crm_team_members
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin is true))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin is true));

drop policy if exists crm_team_members_self_read on public.crm_team_members;
create policy crm_team_members_self_read on public.crm_team_members
  for select to authenticated
  using (user_id = (select auth.uid()) and is_active is true);

-- Existing lead pool remains shared only among verified admins and active CRM staff.
drop policy if exists "seller_leads_admin_select" on public.seller_leads;
drop policy if exists "seller_leads_admin_insert" on public.seller_leads;
drop policy if exists "seller_leads_admin_update" on public.seller_leads;
drop policy if exists "seller_leads_admin_delete" on public.seller_leads;
create policy seller_leads_crm_select on public.seller_leads for select to authenticated using (public.is_crm_staff());
create policy seller_leads_crm_insert on public.seller_leads for insert to authenticated with check (public.is_crm_staff());
create policy seller_leads_crm_update on public.seller_leads for update to authenticated using (public.is_crm_staff()) with check (public.is_crm_staff());
create policy seller_leads_crm_delete on public.seller_leads for delete to authenticated using (public.is_crm_staff());

-- Follow-up and activity tables are already created by the prior CRM migration.
drop policy if exists seller_lead_tasks_admin_select on public.seller_lead_tasks;
drop policy if exists seller_lead_tasks_admin_insert on public.seller_lead_tasks;
drop policy if exists seller_lead_tasks_admin_update on public.seller_lead_tasks;
drop policy if exists seller_lead_tasks_admin_delete on public.seller_lead_tasks;
create policy seller_lead_tasks_crm_select on public.seller_lead_tasks for select to authenticated using (public.is_crm_staff());
create policy seller_lead_tasks_crm_insert on public.seller_lead_tasks for insert to authenticated with check (public.is_crm_staff());
create policy seller_lead_tasks_crm_update on public.seller_lead_tasks for update to authenticated using (public.is_crm_staff()) with check (public.is_crm_staff());
create policy seller_lead_tasks_crm_delete on public.seller_lead_tasks for delete to authenticated using (public.is_crm_staff());

drop policy if exists seller_lead_activities_admin_select on public.seller_lead_activities;
drop policy if exists seller_lead_activities_admin_insert on public.seller_lead_activities;
drop policy if exists seller_lead_activities_admin_update on public.seller_lead_activities;
drop policy if exists seller_lead_activities_admin_delete on public.seller_lead_activities;
create policy seller_lead_activities_crm_select on public.seller_lead_activities for select to authenticated using (public.is_crm_staff());
create policy seller_lead_activities_crm_insert on public.seller_lead_activities for insert to authenticated with check (public.is_crm_staff());
create policy seller_lead_activities_crm_update on public.seller_lead_activities for update to authenticated using (public.is_crm_staff()) with check (public.is_crm_staff());
create policy seller_lead_activities_crm_delete on public.seller_lead_activities for delete to authenticated using (public.is_crm_staff());

create unique index if not exists crm_team_members_email_lower_idx on public.crm_team_members (lower(email)) where email is not null;

-- Department-scoped, read-only support queue. Returns a narrow projection, not customer/seller IDs or message bodies.
create or replace function public.crm_support_ticket_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_channel text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.role into v_role
  from public.crm_team_members m
  where m.user_id = v_uid and m.is_active is true
    and m.role in ('customer_support','seller_support');

  if v_role is null then
    raise exception 'Customer Support or Seller Support access required' using errcode = '42501';
  end if;

  v_channel := case when v_role = 'customer_support' then 'customer_support' else 'seller_support' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'ticket_code', t.ticket_code,
    'channel', t.channel,
    'issue_type', t.issue_type,
    'subject', t.subject,
    'status', t.status,
    'priority', t.priority,
    'created_at', t.created_at,
    'sla_due_at', t.sla_due_at
  ) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select id, ticket_code, channel, issue_type, subject, status, priority, created_at, sla_due_at
    from public.support_tickets
    where channel = v_channel
    order by created_at desc
    limit 200
  ) t;

  return v_result;
end;
$function$;
revoke all on function public.crm_support_ticket_queue() from public, anon;
grant execute on function public.crm_support_ticket_queue() to authenticated;

comment on table public.crm_team_members is 'CRM-only staff allowlist. No public self-signup; admins provision Supabase Auth users and assign customer_support, seller_support, sales, or marketing roles. Support roles are rostered but do not receive seller-acquisition table access until dedicated support permissions are implemented.';


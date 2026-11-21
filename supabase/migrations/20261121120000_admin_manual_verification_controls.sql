-- Audited admin controls for manual customer, seller-bank, and seller-profile verification.
create table if not exists public.customer_manual_verification (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified','verified','not_verified')),
  note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.customer_manual_verification enable row level security;
revoke all on public.customer_manual_verification from anon, authenticated;

create table if not exists public.customer_manual_verification_events (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  old_status text not null,
  new_status text not null check (new_status in ('verified','not_verified')),
  note text not null check (length(trim(note)) between 1 and 500),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.customer_manual_verification_events enable row level security;
revoke all on public.customer_manual_verification_events from anon, authenticated;

create table if not exists public.seller_bank_verification_events (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  old_status text not null,
  new_status text not null check (new_status in ('verified','unverified')),
  note text not null check (length(trim(note)) between 1 and 500),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.seller_bank_verification_events enable row level security;
revoke all on public.seller_bank_verification_events from anon, authenticated;

create table if not exists public.seller_profile_status_events (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  old_status text not null,
  new_status text not null check (new_status in ('active','pending','suspended')),
  note text not null check (length(trim(note)) between 1 and 500),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.seller_profile_status_events enable row level security;
revoke all on public.seller_profile_status_events from anon, authenticated;

create or replace function public.admin_list_customer_manual_verification(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns table(
  customer_id uuid,
  status text,
  note text,
  reviewed_at timestamptz,
  email_confirmed_at timestamptz
)
language plpgsql security definer set search_path = 'pg_catalog','public'
as $$
declare
  v_uid uuid := auth.uid();
  v_search text := nullif(trim(coalesce(p_search,'')),'');
  v_limit integer := least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer := greatest(coalesce(p_offset,0),0);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  return query
  select p.id,coalesce(m.status,'unverified'),m.note,m.reviewed_at,u.email_confirmed_at
  from public.profiles p
  join auth.users u on u.id=p.id
  left join public.customer_manual_verification m on m.customer_id=p.id
  where coalesce(p.is_admin,false)=false
    and (v_search is null or coalesce(p.full_name,'') ilike '%'||v_search||'%' or coalesce(u.email,'') ilike '%'||v_search||'%' or coalesce(p.phone,'') ilike '%'||v_search||'%')
  order by p.created_at desc
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_set_customer_manual_verification(
  p_customer_id uuid,
  p_status text,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = 'pg_catalog','public'
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status,'')));
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_old text;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  if v_status not in ('verified','not_verified') then raise exception 'Status must be Verified or Not verified'; end if;
  if v_note is null or length(v_note)>500 then raise exception 'A reason of 1 to 500 characters is required'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_customer_id and coalesce(p.is_admin,false)=false) then raise exception 'Customer not found'; end if;
  select coalesce(m.status,'unverified') into v_old from public.profiles p
    left join public.customer_manual_verification m on m.customer_id=p.id
    where p.id=p_customer_id for update of p;
  insert into public.customer_manual_verification(customer_id,status,note,reviewed_by,reviewed_at,updated_at)
    values(p_customer_id,v_status,v_note,v_uid,v_now,v_now)
    on conflict(customer_id) do update set status=excluded.status,note=excluded.note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at;
  insert into public.customer_manual_verification_events(customer_id,old_status,new_status,note,actor_id)
    values(p_customer_id,coalesce(v_old,'unverified'),v_status,v_note,v_uid);
  return jsonb_build_object('ok',true,'customer_id',p_customer_id,'old_status',coalesce(v_old,'unverified'),'new_status',v_status,'reviewed_at',v_now);
end;
$$;

create or replace function public.admin_review_seller_bank_account(
  p_seller_id uuid,
  p_decision text,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = 'pg_catalog','public'
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_decision,'')));
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_old text;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if v_status not in ('verified','unverified') then raise exception 'Status must be Verified or Not verified'; end if;
  if v_note is null or length(v_note)>500 then raise exception 'A reason of 1 to 500 characters is required'; end if;
  select bank_verification_status into v_old from public.seller_payout_profiles where seller_id=p_seller_id for update;
  if not found then raise exception 'Seller payout account not found'; end if;
  update public.seller_payout_profiles
    set bank_verification_status=v_status,
        bank_verified_at=case when v_status='verified' then v_now else null end,
        updated_at=v_now
    where seller_id=p_seller_id;
  insert into public.seller_bank_verification_events(seller_id,old_status,new_status,note,actor_id)
    values(p_seller_id,coalesce(v_old,'unverified'),v_status,v_note,v_uid);
  return jsonb_build_object('ok',true,'seller_id',p_seller_id,'old_status',coalesce(v_old,'unverified'),'new_status',v_status,'reviewed_at',v_now);
end;
$$;

create or replace function public.admin_update_seller_profile_status(
  p_seller_id uuid,
  p_status text,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = 'pg_catalog','public'
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status,'')));
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_old text;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if v_status not in ('active','pending','suspended') then raise exception 'Invalid seller profile status'; end if;
  if v_note is null or length(v_note)>500 then raise exception 'A reason of 1 to 500 characters is required'; end if;
  select status into v_old from public.seller_profiles where user_id=p_seller_id for update;
  if not found then raise exception 'Seller not found'; end if;
  update public.seller_profiles set status=v_status,updated_at=v_now where user_id=p_seller_id;
  insert into public.seller_profile_status_events(seller_id,old_status,new_status,note,actor_id)
    values(p_seller_id,v_old,v_status,v_note,v_uid);
  return jsonb_build_object('ok',true,'seller_id',p_seller_id,'old_status',v_old,'new_status',v_status,'updated_at',v_now);
end;
$$;

create or replace function public.admin_list_seller_bank_verification(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns table(seller_id uuid, bank_verification_status text, bank_account_present boolean)
language plpgsql security definer set search_path = 'pg_catalog','public'
as $$
declare
  v_uid uuid := auth.uid();
  v_search text := nullif(trim(coalesce(p_search,'')),'');
  v_limit integer := least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer := greatest(coalesce(p_offset,0),0);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  return query
  select s.user_id,coalesce(pp.bank_verification_status,'unverified'),pp.seller_id is not null
  from public.seller_profiles s
  join auth.users u on u.id=s.user_id
  left join public.seller_payout_profiles pp on pp.seller_id=s.user_id
  where (v_search is null or s.seller_code ilike '%'||v_search||'%' or s.store_name ilike '%'||v_search||'%' or coalesce(u.email,'') ilike '%'||v_search||'%')
  order by s.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_list_customer_manual_verification(text,integer,integer) from public,anon;
revoke all on function public.admin_list_seller_bank_verification(text,integer,integer) from public,anon;
revoke all on function public.admin_set_customer_manual_verification(uuid,text,text) from public,anon;
revoke all on function public.admin_review_seller_bank_account(uuid,text,text) from public,anon;
revoke all on function public.admin_update_seller_profile_status(uuid,text,text) from public,anon;
grant execute on function public.admin_list_customer_manual_verification(text,integer,integer) to authenticated;
grant execute on function public.admin_list_seller_bank_verification(text,integer,integer) to authenticated;
grant execute on function public.admin_set_customer_manual_verification(uuid,text,text) to authenticated;
grant execute on function public.admin_review_seller_bank_account(uuid,text,text) to authenticated;
grant execute on function public.admin_update_seller_profile_status(uuid,text,text) to authenticated;

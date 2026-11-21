alter table public.seller_compliance_profiles
  add column if not exists pan_number text,
  add column if not exists gstin_number text;
alter table public.seller_payout_profiles
  add column if not exists account_number text;
alter table public.business_bank_profiles
  add column if not exists account_number text;

comment on column public.seller_compliance_profiles.pan_number is 'Full seller PAN retained for authenticated owner submission and audited Admin compliance review.';
comment on column public.seller_compliance_profiles.gstin_number is 'Full seller GSTIN retained for authenticated owner submission and audited Admin compliance review.';
comment on column public.seller_payout_profiles.account_number is 'Full seller payout bank account retained for authenticated owner submission and audited Admin payout review.';
comment on column public.business_bank_profiles.account_number is 'Full customer business bank account retained for authenticated owner submission and audited Admin review.';

alter table public.seller_compliance_profiles enable row level security;
alter table public.seller_payout_profiles enable row level security;
alter table public.business_bank_profiles enable row level security;

create table if not exists public.seller_sensitive_verification_access_events (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  admin_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.seller_sensitive_verification_access_events enable row level security;
revoke all on public.seller_sensitive_verification_access_events from public, anon, authenticated;

create table if not exists public.customer_business_bank_access_events (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  admin_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.customer_business_bank_access_events enable row level security;
revoke all on public.customer_business_bank_access_events from public, anon, authenticated;

alter function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text)
  rename to save_seller_compliance_profile_legacy;
revoke all on function public.save_seller_compliance_profile_legacy(text,text,text,text,boolean,text,text,text,text,text,text,text) from public, anon, authenticated;

create or replace function public.save_seller_compliance_profile(
  p_legal_name text, p_trade_name text, p_entity_type text, p_primary_category text,
  p_gst_registered boolean, p_pan text, p_gstin text, p_account_holder_name text,
  p_bank_name text, p_ifsc text, p_account_number text, p_account_type text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_pan text := upper(regexp_replace(coalesce(p_pan,''),'[^A-Za-z0-9]','','g'));
  v_gstin text := upper(regexp_replace(coalesce(p_gstin,''),'[^A-Za-z0-9]','','g'));
  v_account text := regexp_replace(coalesce(p_account_number,''),'[^0-9]','','g');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  v_result := public.save_seller_compliance_profile_legacy(
    p_legal_name,p_trade_name,p_entity_type,p_primary_category,p_gst_registered,p_pan,p_gstin,
    p_account_holder_name,p_bank_name,p_ifsc,p_account_number,p_account_type
  );
  update public.seller_compliance_profiles
     set pan_number = case when v_pan <> '' then v_pan else pan_number end,
         gstin_number = case when coalesce(p_gst_registered,false)
                             then case when v_gstin <> '' then v_gstin else gstin_number end
                             else null end
   where seller_id = v_uid;
  if v_account <> '' then
    update public.seller_payout_profiles set account_number = v_account where seller_id = v_uid;
  end if;
  return v_result;
end;
$$;
revoke all on function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text) to authenticated;

create or replace function public.admin_list_seller_sensitive_verification_details(
  p_search text default null, p_limit integer default 100, p_offset integer default 0
) returns table(seller_id uuid, pan_number text, gstin_number text, payout_account_number text)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_search text := nullif(trim(coalesce(p_search,'')),'');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  return query
    with picked as (
      select s.user_id
      from public.seller_profiles s
      join auth.users u on u.id=s.user_id
      left join public.seller_compliance_profiles c on c.seller_id=s.user_id
      where v_search is null or s.seller_code ilike '%'||v_search||'%'
        or s.store_name ilike '%'||v_search||'%'
        or coalesce(u.email,'') ilike '%'||v_search||'%'
        or coalesce(c.legal_name,'') ilike '%'||v_search||'%'
      order by coalesce(c.submitted_at,'9999-12-31'::timestamptz),s.created_at desc
      limit least(greatest(coalesce(p_limit,100),1),200)
      offset greatest(coalesce(p_offset,0),0)
    )
    select s.user_id,c.pan_number,c.gstin_number,pp.account_number
    from picked s
    left join public.seller_compliance_profiles c on c.seller_id=s.user_id
    left join public.seller_payout_profiles pp on pp.seller_id=s.user_id;
  insert into public.seller_sensitive_verification_access_events(seller_id,admin_id)
    select s.user_id,v_uid from public.seller_profiles s join auth.users u on u.id=s.user_id
    left join public.seller_compliance_profiles c on c.seller_id=s.user_id
    where (v_search is null or s.seller_code ilike '%'||v_search||'%' or s.store_name ilike '%'||v_search||'%'
      or coalesce(u.email,'') ilike '%'||v_search||'%' or coalesce(c.legal_name,'') ilike '%'||v_search||'%')
    order by coalesce(c.submitted_at,'9999-12-31'::timestamptz),s.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),200) offset greatest(coalesce(p_offset,0),0);
end;
$$;
revoke all on function public.admin_list_seller_sensitive_verification_details(text,integer,integer) from public, anon;
grant execute on function public.admin_list_seller_sensitive_verification_details(text,integer,integer) to authenticated;

create or replace function public.admin_list_customer_bank_sensitive_details(
  p_status text default null, p_search text default null, p_limit integer default 100
) returns table(customer_id uuid, account_number text)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_status text := nullif(trim(coalesce(p_status,'')),''); v_search text := nullif(trim(coalesce(p_search,'')),'');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  if v_status is not null and v_status not in ('pending_review','verified','changes_requested') then
    raise exception 'Invalid review status';
  end if;
  insert into public.customer_business_bank_access_events(customer_id,admin_id)
    select bb.user_id,v_uid from public.business_bank_profiles bb
    join auth.users u on u.id=bb.user_id
    left join public.profiles p on p.id=bb.user_id
    left join public.business_profiles b on b.user_id=bb.user_id
    where (v_status is null or bb.admin_review_status=v_status)
      and (v_search is null or coalesce(p.full_name,'') ilike '%'||v_search||'%'
        or coalesce(u.email,'') ilike '%'||v_search||'%'
        or coalesce(b.business_name,'') ilike '%'||v_search||'%'
        or coalesce(bb.bank_name,'') ilike '%'||v_search||'%' or coalesce(bb.ifsc,'') ilike '%'||v_search||'%')
    order by case bb.admin_review_status when 'pending_review' then 0 when 'changes_requested' then 1 else 2 end,bb.updated_at desc
    limit least(greatest(coalesce(p_limit,100),1),200);
  return query
    select bb.user_id,bb.account_number from public.business_bank_profiles bb
    join auth.users u on u.id=bb.user_id
    left join public.profiles p on p.id=bb.user_id
    left join public.business_profiles b on b.user_id=bb.user_id
    where (v_status is null or bb.admin_review_status=v_status)
      and (v_search is null or coalesce(p.full_name,'') ilike '%'||v_search||'%'
        or coalesce(u.email,'') ilike '%'||v_search||'%'
        or coalesce(b.business_name,'') ilike '%'||v_search||'%'
        or coalesce(bb.bank_name,'') ilike '%'||v_search||'%' or coalesce(bb.ifsc,'') ilike '%'||v_search||'%')
    order by case bb.admin_review_status when 'pending_review' then 0 when 'changes_requested' then 1 else 2 end,bb.updated_at desc
    limit least(greatest(coalesce(p_limit,100),1),200);
end;
$$;
revoke all on function public.admin_list_customer_bank_sensitive_details(text,text,integer) from public, anon;
grant execute on function public.admin_list_customer_bank_sensitive_details(text,text,integer) to authenticated;

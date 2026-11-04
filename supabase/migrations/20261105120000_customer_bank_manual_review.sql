-- Temporary admin review for Business & Bulk customer bank verification.
-- Provider verification remains in verification_status; review decisions are stored separately.
alter table public.business_bank_profiles
  add column if not exists admin_review_status text not null default 'pending_review',
  add column if not exists admin_review_reason text,
  add column if not exists admin_reviewed_at timestamptz,
  add column if not exists admin_reviewed_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='business_bank_profiles_admin_review_status_check'
      and conrelid='public.business_bank_profiles'::regclass
  ) then
    alter table public.business_bank_profiles
      add constraint business_bank_profiles_admin_review_status_check
      check (admin_review_status in ('pending_review','verified','changes_requested'));
  end if;
end $$;

create index if not exists business_bank_profiles_admin_review_queue_idx
  on public.business_bank_profiles (updated_at desc)
  where admin_review_status='pending_review';

create or replace function public.reset_customer_bank_admin_review()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='INSERT' then
    new.admin_review_status:='pending_review';
    new.admin_review_reason:=null;
    new.admin_reviewed_at:=null;
    new.admin_reviewed_by:=null;
    return new;
  end if;
  if old.account_holder_name is distinct from new.account_holder_name
     or old.bank_name is distinct from new.bank_name
     or old.ifsc is distinct from new.ifsc
     or old.account_number_last4 is distinct from new.account_number_last4
     or old.provider_reference is distinct from new.provider_reference
     or old.verification_status is distinct from new.verification_status
     or old.updated_at is distinct from new.updated_at then
    new.admin_review_status:='pending_review';
    new.admin_review_reason:=null;
    new.admin_reviewed_at:=null;
    new.admin_reviewed_by:=null;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_bank_admin_review_reset on public.business_bank_profiles;
create trigger customer_bank_admin_review_reset
before insert or update of account_holder_name,bank_name,ifsc,account_number_last4,provider_reference,verification_status,updated_at
on public.business_bank_profiles
for each row execute function public.reset_customer_bank_admin_review();

create or replace function public.admin_list_customer_bank_reviews(
  p_status text default null,
  p_search text default null,
  p_limit integer default 100
) returns table(
  customer_id uuid,
  full_name text,
  email text,
  business_name text,
  account_holder_name text,
  bank_name text,
  ifsc text,
  account_number_last4 text,
  verification_status text,
  admin_review_status text,
  admin_review_reason text,
  admin_reviewed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text := nullif(trim(coalesce(p_status,'')),'');
  v_search text := nullif(trim(coalesce(p_search,'')),'');
  v_limit integer := least(greatest(coalesce(p_limit,100),1),200);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  if v_status is not null and v_status not in ('pending_review','verified','changes_requested') then
    raise exception 'Invalid review status';
  end if;
  return query
  select bb.user_id,coalesce(p.full_name,'Customer'),u.email::text,b.business_name,
         bb.account_holder_name,bb.bank_name,bb.ifsc,bb.account_number_last4,
         bb.verification_status,bb.admin_review_status,bb.admin_review_reason,bb.admin_reviewed_at,bb.updated_at
  from public.business_bank_profiles bb
  join auth.users u on u.id=bb.user_id
  left join public.profiles p on p.id=bb.user_id
  left join public.business_profiles b on b.user_id=bb.user_id
  where (v_status is null or bb.admin_review_status=v_status)
    and (v_search is null
      or coalesce(p.full_name,'') ilike '%'||v_search||'%'
      or coalesce(u.email,'') ilike '%'||v_search||'%'
      or coalesce(b.business_name,'') ilike '%'||v_search||'%'
      or coalesce(bb.bank_name,'') ilike '%'||v_search||'%'
      or coalesce(bb.ifsc,'') ilike '%'||v_search||'%')
  order by case bb.admin_review_status when 'pending_review' then 0 when 'changes_requested' then 1 else 2 end,
           bb.updated_at desc
  limit v_limit;
end;
$$;

create or replace function public.admin_review_customer_bank(
  p_customer_id uuid,
  p_decision text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_decision text := lower(trim(coalesce(p_decision,'')));
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;
  if v_decision not in ('verified','changes_requested') then raise exception 'Invalid review decision'; end if;
  if v_decision='changes_requested' and (v_reason is null or length(v_reason)>500) then
    raise exception 'A reason of 1 to 500 characters is required';
  end if;
  update public.business_bank_profiles
  set admin_review_status=v_decision,
      admin_review_reason=case when v_decision='changes_requested' then v_reason else null end,
      admin_reviewed_at=v_now,
      admin_reviewed_by=v_uid
  where user_id=p_customer_id;
  if not found then raise exception 'Customer bank profile not found'; end if;
  return jsonb_build_object('ok',true,'customer_id',p_customer_id,'decision',v_decision,'reviewed_at',v_now);
end;
$$;

revoke all on function public.admin_list_customer_bank_reviews(text,text,integer) from public,anon;
revoke all on function public.admin_review_customer_bank(uuid,text,text) from public,anon;
grant execute on function public.admin_list_customer_bank_reviews(text,text,integer) to authenticated;
grant execute on function public.admin_review_customer_bank(uuid,text,text) to authenticated;
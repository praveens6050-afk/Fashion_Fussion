-- Separate retail customers from business/bulk buyers and keep bank verification server-controlled.

alter table public.profiles
  add column if not exists account_type text not null default 'retail';

alter table public.profiles
  drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check check (account_type = any (array['retail'::text,'business'::text]));

alter table public.business_profiles
  add column if not exists gst_verification_status text not null default 'unverified',
  add column if not exists gst_verified_at timestamptz,
  add column if not exists gst_verification_ref text;

alter table public.business_profiles
  drop constraint if exists business_profiles_gst_verification_status_check;
alter table public.business_profiles
  add constraint business_profiles_gst_verification_status_check
  check (gst_verification_status = any (array['unverified'::text,'pending'::text,'verified'::text,'failed'::text]));

create or replace function public.protect_business_gst_verification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.gst_verification_status := 'unverified';
      new.gst_verified_at := null;
      new.gst_verification_ref := null;
    else
      if new.gstin is distinct from old.gstin then
        new.gst_verification_status := 'unverified';
        new.gst_verified_at := null;
        new.gst_verification_ref := null;
      else
        new.gst_verification_status := old.gst_verification_status;
        new.gst_verified_at := old.gst_verified_at;
        new.gst_verification_ref := old.gst_verification_ref;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists protect_business_gst_verification_before_write on public.business_profiles;
create trigger protect_business_gst_verification_before_write
before insert or update on public.business_profiles
for each row execute function public.protect_business_gst_verification();

create or replace function public.mark_customer_profile_business()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.profiles
  set account_type = 'business', updated_at = now()
  where id = new.user_id and account_type <> 'business';
  return new;
end;
$function$;

drop trigger if exists mark_customer_profile_business_after_insert on public.business_profiles;
create trigger mark_customer_profile_business_after_insert
after insert on public.business_profiles
for each row execute function public.mark_customer_profile_business();

create table if not exists public.business_bank_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_holder_name text not null check (char_length(btrim(account_holder_name)) between 2 and 120),
  bank_name text,
  ifsc text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_number_last4 text not null check (account_number_last4 ~ '^[0-9]{4}$'),
  account_type text not null default 'current' check (account_type = any (array['current'::text,'savings'::text])),
  provider text not null default 'cashfree_secure_id',
  provider_reference text,
  verification_status text not null default 'unverified' check (verification_status = any (array['unverified'::text,'pending'::text,'verified'::text,'failed'::text])),
  verified_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_bank_profiles enable row level security;

drop policy if exists business_bank_profiles_select_own on public.business_bank_profiles;
create policy business_bank_profiles_select_own
on public.business_bank_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.business_bank_profiles from anon, authenticated;
grant select on table public.business_bank_profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_type text;
  v_business_name text;
  v_gstin text;
  v_billing text;
begin
  v_account_type := case when lower(coalesce(new.raw_user_meta_data ->> 'account_type','')) = 'business' then 'business' else 'retail' end;

  insert into public.profiles (id, full_name, phone, account_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    v_account_type
  )
  on conflict (id) do update
    set full_name = case when coalesce(public.profiles.full_name,'') = '' then excluded.full_name else public.profiles.full_name end,
        phone = coalesce(public.profiles.phone, excluded.phone),
        account_type = case when public.profiles.account_type = 'retail' and excluded.account_type = 'business' then 'business' else public.profiles.account_type end;

  if v_account_type = 'business' then
    v_business_name := btrim(coalesce(new.raw_user_meta_data ->> 'business_name',''));
    if char_length(v_business_name) < 2 or char_length(v_business_name) > 160 then
      v_business_name := 'Business account';
    end if;
    v_gstin := upper(btrim(coalesce(new.raw_user_meta_data ->> 'business_gstin','')));
    if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
      v_gstin := null;
    end if;
    v_billing := btrim(coalesce(new.raw_user_meta_data ->> 'business_billing_address',''));

    insert into public.business_profiles (user_id,business_name,gstin,billing_address)
    values (new.id,v_business_name,v_gstin,case when v_billing <> '' then jsonb_build_object('text',v_billing) else null end)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$function$;

update public.profiles p
set account_type = 'business', updated_at = now()
where account_type = 'retail'
  and exists (select 1 from public.business_profiles b where b.user_id = p.id);

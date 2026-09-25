-- External seller verification state + safe authenticated E2E cleanup.
-- Provider credentials stay server-side in Cloudflare environment variables.

alter table public.seller_compliance_profiles
  add column if not exists pan_verification_status text not null default 'unverified',
  add column if not exists pan_verified_at timestamptz,
  add column if not exists pan_verification_ref text,
  add column if not exists gst_verification_status text not null default 'unverified',
  add column if not exists gst_verified_at timestamptz,
  add column if not exists gst_verification_ref text;

alter table public.seller_payout_profiles
  add column if not exists bank_verification_status text not null default 'unverified',
  add column if not exists bank_verified_at timestamptz,
  add column if not exists bank_verification_ref text;

alter table public.seller_pickup_locations
  add column if not exists address_verification_status text not null default 'unverified',
  add column if not exists address_verified_at timestamptz,
  add column if not exists google_place_id text,
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(10,7);

create or replace function public.reset_seller_external_verification_state()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_table_name='seller_compliance_profiles' then
    if old.pan_last4 is distinct from new.pan_last4 then
      new.pan_verification_status:='unverified';
      new.pan_verified_at:=null;
      new.pan_verification_ref:=null;
    end if;
    if old.gstin_last4 is distinct from new.gstin_last4 or old.gst_registered is distinct from new.gst_registered then
      new.gst_verification_status:='unverified';
      new.gst_verified_at:=null;
      new.gst_verification_ref:=null;
    end if;
  elsif tg_table_name='seller_payout_profiles' then
    if old.account_holder_name is distinct from new.account_holder_name
       or old.ifsc is distinct from new.ifsc
       or old.account_number_last4 is distinct from new.account_number_last4 then
      new.bank_verification_status:='unverified';
      new.bank_verified_at:=null;
      new.bank_verification_ref:=null;
    end if;
  elsif tg_table_name='seller_pickup_locations' then
    if old.line1 is distinct from new.line1 or old.line2 is distinct from new.line2
       or old.city is distinct from new.city or old.state is distinct from new.state
       or old.pincode is distinct from new.pincode then
      new.address_verification_status:='unverified';
      new.address_verified_at:=null;
      new.google_place_id:=null;
      new.latitude:=null;
      new.longitude:=null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists seller_compliance_external_verification_reset on public.seller_compliance_profiles;
create trigger seller_compliance_external_verification_reset
before update on public.seller_compliance_profiles
for each row execute function public.reset_seller_external_verification_state();

drop trigger if exists seller_payout_external_verification_reset on public.seller_payout_profiles;
create trigger seller_payout_external_verification_reset
before update on public.seller_payout_profiles
for each row execute function public.reset_seller_external_verification_state();

drop trigger if exists seller_pickup_external_verification_reset on public.seller_pickup_locations;
create trigger seller_pickup_external_verification_reset
before update on public.seller_pickup_locations
for each row execute function public.reset_seller_external_verification_state();

create or replace function public.cleanup_seller_e2e_submissions()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.seller_product_submissions
  where seller_id=auth.uid()
    and approved_product_id is null
    and name like 'E2E Seller Catalog %'
    and sku like 'E2E-%';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.cleanup_seller_e2e_submissions() from public;
grant execute on function public.cleanup_seller_e2e_submissions() to authenticated;

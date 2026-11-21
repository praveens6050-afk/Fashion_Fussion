-- Store a customer-selected payout destination for manually issued refunds.
-- Prepaid refunds must continue to use the original payment provider.
create table if not exists public.customer_refund_destinations (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  method text not null check (method in ('bank','upi')),
  account_holder_name text,
  bank_name text,
  account_number text,
  ifsc text,
  upi_id text,
  updated_at timestamptz not null default now(),
  constraint customer_refund_destination_fields check (
    (method = 'bank'
      and account_holder_name is not null
      and bank_name is not null
      and account_number ~ '^[0-9]{6,34}$'
      and ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
      and upi_id is null)
    or
    (method = 'upi'
      and upi_id ~ '^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,50}$'
      and account_holder_name is null
      and bank_name is null
      and account_number is null
      and ifsc is null)
  )
);

alter table public.customer_refund_destinations enable row level security;
revoke all on public.customer_refund_destinations from public, anon, authenticated;
comment on table public.customer_refund_destinations is
  'Customer-selected destination for manual refunds only. Full bank/UPI details are available only through authenticated owner/admin RPCs.';

create table if not exists public.customer_refund_destination_access_events (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  admin_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.customer_refund_destination_access_events enable row level security;
revoke all on public.customer_refund_destination_access_events from public, anon, authenticated;

create or replace function public.customer_save_refund_destination(
  p_method text,
  p_account_holder_name text default null,
  p_bank_name text default null,
  p_account_number text default null,
  p_ifsc text default null,
  p_upi_id text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_method text := lower(trim(coalesce(p_method,'')));
  v_account text := regexp_replace(coalesce(p_account_number,''),'\s','','g');
  v_ifsc text := upper(trim(coalesce(p_ifsc,'')));
  v_upi text := lower(trim(coalesce(p_upi_id,'')));
  v_holder text := nullif(trim(coalesce(p_account_holder_name,'')),'');
  v_bank text := nullif(trim(coalesce(p_bank_name,'')),'');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_method not in ('bank','upi') then raise exception 'Choose bank account or UPI'; end if;
  if v_method='bank' then
    if v_holder is null or length(v_holder)>120 or v_bank is null or length(v_bank)>120 then raise exception 'Complete the bank account holder and bank name'; end if;
    if v_account !~ '^[0-9]{6,34}$' then raise exception 'Enter a valid bank account number'; end if;
    if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Enter a valid IFSC'; end if;
    insert into public.customer_refund_destinations(customer_id,method,account_holder_name,bank_name,account_number,ifsc,upi_id,updated_at)
    values(v_uid,'bank',v_holder,v_bank,v_account,v_ifsc,null,now())
    on conflict(customer_id) do update set method='bank',account_holder_name=excluded.account_holder_name,bank_name=excluded.bank_name,account_number=excluded.account_number,ifsc=excluded.ifsc,upi_id=null,updated_at=now();
    return jsonb_build_object('ok',true,'method','bank','account_number_last4',right(v_account,4));
  end if;
  if v_upi !~ '^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,50}$' then raise exception 'Enter a valid UPI ID'; end if;
  insert into public.customer_refund_destinations(customer_id,method,account_holder_name,bank_name,account_number,ifsc,upi_id,updated_at)
  values(v_uid,'upi',null,null,null,null,v_upi,now())
  on conflict(customer_id) do update set method='upi',account_holder_name=null,bank_name=null,account_number=null,ifsc=null,upi_id=excluded.upi_id,updated_at=now();
  return jsonb_build_object('ok',true,'method','upi','upi_masked',left(v_upi,2)||'***@'||split_part(v_upi,'@',2));
end;
$$;

create or replace function public.customer_get_refund_destination()
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_row public.customer_refund_destinations%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_row from public.customer_refund_destinations where customer_id=v_uid;
  if not found then return '{}'::jsonb; end if;
  if v_row.method='bank' then return jsonb_build_object('method','bank','account_number_last4',right(v_row.account_number,4)); end if;
  return jsonb_build_object('method','upi','upi_masked',left(v_row.upi_id,2)||'***@'||split_part(v_row.upi_id,'@',2));
end;
$$;

create or replace function public.customer_clear_refund_destination()
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  delete from public.customer_refund_destinations where customer_id=v_uid;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.admin_get_customer_refund_destination(p_customer_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_row public.customer_refund_destinations%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  select * into v_row from public.customer_refund_destinations where customer_id=p_customer_id;
  if not found then return '{}'::jsonb; end if;
  insert into public.customer_refund_destination_access_events(customer_id,admin_id) values(p_customer_id,v_uid);
  return to_jsonb(v_row) - 'customer_id';
end;
$$;

revoke all on function public.customer_save_refund_destination(text,text,text,text,text,text) from public, anon;
revoke all on function public.customer_get_refund_destination() from public, anon;
revoke all on function public.customer_clear_refund_destination() from public, anon;
revoke all on function public.admin_get_customer_refund_destination(uuid) from public, anon;
grant execute on function public.customer_save_refund_destination(text,text,text,text,text,text) to authenticated;
grant execute on function public.customer_get_refund_destination() to authenticated;
grant execute on function public.customer_clear_refund_destination() to authenticated;
grant execute on function public.admin_get_customer_refund_destination(uuid) to authenticated;


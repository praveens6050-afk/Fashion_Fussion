-- Merchant-side UPI MDR accounting effective 15 Oct 2026.
-- This is an internal payment-processing cost and must never be added to customer checkout totals.

create or replace function public.calculate_upi_merchant_mdr(
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz,
  p_provider_fee_amount numeric default null,
  p_mdr_eligible boolean default true
)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_mdr_eligible, false) = false then 0::numeric
    when p_paid_at is null or p_paid_at < timestamptz '2026-10-15 00:00:00+05:30' then 0::numeric
    when lower(trim(coalesce(p_payment_method, ''))) not in ('upi', 'upi_intent', 'upi_collect') then 0::numeric
    when coalesce(p_amount, 0) <= 2000 then 0::numeric
    -- If the gateway/provider already reports a positive processing fee, do not add a second MDR estimate.
    when coalesce(p_provider_fee_amount, 0) > 0 then 0::numeric
    else least(round(coalesce(p_amount, 0) * 0.004, 2), 300::numeric)
  end;
$$;

comment on function public.calculate_upi_merchant_mdr(numeric,text,timestamptz,numeric,boolean) is
'Internal merchant UPI MDR estimate: 0.4% above INR 2,000 from 2026-10-15 IST, capped at INR 300. Returns zero for ineligible/non-UPI/pre-effective/provider-fee-reported payments. Never a customer surcharge.';

revoke all on function public.calculate_upi_merchant_mdr(numeric,text,timestamptz,numeric,boolean) from public, anon, authenticated;
grant execute on function public.calculate_upi_merchant_mdr(numeric,text,timestamptz,numeric,boolean) to service_role;

-- Boundary assertions kept in migration so an incorrect future edit fails loudly.
do $$
begin
  if public.calculate_upi_merchant_mdr(2000,'upi','2026-10-15 00:00:00+05:30',null,true) <> 0 then raise exception 'UPI MDR boundary failed at INR 2,000'; end if;
  if public.calculate_upi_merchant_mdr(3000,'upi','2026-10-15 00:00:00+05:30',null,true) <> 12 then raise exception 'UPI MDR failed at INR 3,000'; end if;
  if public.calculate_upi_merchant_mdr(5000,'upi','2026-10-15 00:00:00+05:30',null,true) <> 20 then raise exception 'UPI MDR failed at INR 5,000'; end if;
  if public.calculate_upi_merchant_mdr(75000,'upi','2026-10-15 00:00:00+05:30',null,true) <> 300 then raise exception 'UPI MDR cap failed'; end if;
  if public.calculate_upi_merchant_mdr(100000,'upi','2026-10-15 00:00:00+05:30',null,true) <> 300 then raise exception 'UPI MDR cap failed above INR 75,000'; end if;
  if public.calculate_upi_merchant_mdr(5000,'card','2026-10-15 00:00:00+05:30',null,true) <> 0 then raise exception 'Non-UPI payment incorrectly charged'; end if;
  if public.calculate_upi_merchant_mdr(5000,'upi','2026-10-14 23:59:59+05:30',null,true) <> 0 then raise exception 'Pre-effective UPI payment incorrectly charged'; end if;
  if public.calculate_upi_merchant_mdr(5000,'upi','2026-10-15 00:00:00+05:30',20,true) <> 0 then raise exception 'Provider fee double-charge guard failed'; end if;
  if public.calculate_upi_merchant_mdr(5000,'upi','2026-10-15 00:00:00+05:30',null,false) <> 0 then raise exception 'MDR exemption guard failed'; end if;
end $$;

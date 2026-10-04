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
    when p_amount is null or p_amount <= 2000 then 0::numeric
    when p_payment_method is null then 0::numeric
    when lower(trim(p_payment_method)) not in ('upi','upi_intent','upi_collect') then 0::numeric
    when p_paid_at is null or p_paid_at < timestamptz '2026-10-15 00:00:00+05:30' then 0::numeric
    when coalesce(p_mdr_eligible,false) = false then 0::numeric
    when coalesce(p_provider_fee_amount,0) > 0 then 0::numeric
    else round(least(p_amount * 0.004, 300::numeric), 2)
  end;
$$;

comment on function public.calculate_upi_merchant_mdr(numeric,text,timestamptz,numeric,boolean) is
'Merchant-side fallback estimate: eligible UPI payments above INR 2,000 from 15 Oct 2026 IST use 0.4% MDR capped at INR 300. Never add this amount to customer checkout totals.';

revoke all on function public.calculate_upi_merchant_mdr(numeric,text,timestamptz,numeric,boolean) from public, anon, authenticated;
grant execute on function public.calculate_upi_merchant_mdr(numeric,text,timestamptz,numeric,boolean) to service_role;

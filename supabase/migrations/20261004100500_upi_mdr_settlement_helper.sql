-- Authoritative helper for settlement payment-processing deductions.
-- Actual provider fees take precedence; otherwise eligible UPI payments use the statutory MDR estimate.

create or replace function public.resolve_payment_processing_fee(
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
    when coalesce(p_provider_fee_amount, 0) > 0 then round(p_provider_fee_amount, 2)
    else public.calculate_upi_merchant_mdr(
      p_amount,
      p_payment_method,
      p_paid_at,
      null,
      p_mdr_eligible
    )
  end;
$$;

comment on function public.resolve_payment_processing_fee(numeric,text,timestamptz,numeric,boolean) is
'Authoritative payment-processing deduction resolver for seller settlements. Uses actual provider fee when supplied; otherwise applies eligible UPI MDR estimate. This value is merchant-side only and must not alter customer checkout totals.';

revoke all on function public.resolve_payment_processing_fee(numeric,text,timestamptz,numeric,boolean) from public, anon, authenticated;
grant execute on function public.resolve_payment_processing_fee(numeric,text,timestamptz,numeric,boolean) to service_role;

do $$
begin
  if public.resolve_payment_processing_fee(5000,'upi','2026-10-15 00:00:00+05:30',null,true) <> 20 then raise exception 'UPI MDR settlement resolution failed'; end if;
  if public.resolve_payment_processing_fee(5000,'upi','2026-10-15 00:00:00+05:30',18.50,true) <> 18.50 then raise exception 'Provider actual fee precedence failed'; end if;
end $$;

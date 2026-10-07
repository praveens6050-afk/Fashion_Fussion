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
    when coalesce(p_provider_fee_amount,0) > 0 then round(p_provider_fee_amount,2)
    else public.calculate_upi_merchant_mdr(p_amount,p_payment_method,p_paid_at,null,p_mdr_eligible)
  end;
$$;

comment on function public.resolve_payment_processing_fee(numeric,text,timestamptz,numeric,boolean) is
'Service-side seller settlement payment-processing resolver. Actual provider fee takes precedence over fallback UPI MDR estimate. Must not alter customer checkout totals.';

revoke all on function public.resolve_payment_processing_fee(numeric,text,timestamptz,numeric,boolean) from public, anon, authenticated;
grant execute on function public.resolve_payment_processing_fee(numeric,text,timestamptz,numeric,boolean) to service_role;

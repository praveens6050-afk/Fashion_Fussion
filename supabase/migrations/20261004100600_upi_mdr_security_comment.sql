comment on function public.resolve_payment_processing_fee(numeric,text,timestamptz,numeric,boolean) is
'Service-role settlement helper. Merchant-side accounting only. Customer/browser roles have no EXECUTE grant; customer payable totals must not call or include this function.';

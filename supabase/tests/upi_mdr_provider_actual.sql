begin;
select public.resolve_payment_processing_fee(10000,'upi','2026-10-15 00:00:00+05:30',37.25,true) = 37.25 as provider_actual_over_estimated_40;
rollback;

begin;
select public.resolve_payment_processing_fee(5000,'upi','2026-10-15 00:00:00+05:30',18.50,true) = 18.50 as provider_actual_used;
select public.resolve_payment_processing_fee(5000,'upi','2026-10-15 00:00:00+05:30',0,true) = 20 as zero_provider_fee_falls_back_to_mdr;
rollback;

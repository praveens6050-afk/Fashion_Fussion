begin;
select public.resolve_payment_processing_fee(3000,'upi','2026-10-15 00:00:00+05:30',0,true) = 12 as zero_actual_fee_uses_mdr;
rollback;

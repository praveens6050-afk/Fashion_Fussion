begin;

select public.resolve_payment_processing_fee(5000,'upi','2026-10-15 00:00:00+05:30',null,true) = 20 as estimated_upi_mdr;
select public.resolve_payment_processing_fee(5000,'upi','2026-10-15 00:00:00+05:30',18.50,true) = 18.50 as actual_provider_fee_wins;
select public.resolve_payment_processing_fee(5000,'card','2026-10-15 00:00:00+05:30',25,true) = 25 as actual_card_provider_fee;
select public.resolve_payment_processing_fee(5000,'card','2026-10-15 00:00:00+05:30',null,true) = 0 as no_invented_non_upi_fee;
select public.resolve_payment_processing_fee(5000,'upi','2026-10-15 00:00:00+05:30',null,false) = 0 as exempt_upi_fee;

rollback;

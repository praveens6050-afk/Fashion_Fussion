-- Expected merchant-side processing costs (not customer charges)
select public.resolve_payment_processing_fee(3000,'upi','2026-10-15 12:00:00+05:30',null,true) as inr_3000_expected_12;
select public.resolve_payment_processing_fee(5000,'upi','2026-10-15 12:00:00+05:30',null,true) as inr_5000_expected_20;
select public.resolve_payment_processing_fee(10000,'upi','2026-10-15 12:00:00+05:30',null,true) as inr_10000_expected_40;
select public.resolve_payment_processing_fee(75000,'upi','2026-10-15 12:00:00+05:30',null,true) as inr_75000_expected_300;

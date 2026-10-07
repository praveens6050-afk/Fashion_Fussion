begin;
select public.calculate_upi_merchant_mdr(2000.01,'upi','2026-10-15 00:00:00+05:30',null,true) = 8.00 as threshold_rounding;
select public.calculate_upi_merchant_mdr(2001.25,'upi','2026-10-15 00:00:00+05:30',null,true) = 8.01 as currency_rounding;
rollback;

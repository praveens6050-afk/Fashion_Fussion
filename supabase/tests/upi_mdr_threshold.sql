begin;
select public.calculate_upi_merchant_mdr(1999.99,'upi','2026-10-15 00:00:00+05:30',null,true) = 0 as below_threshold;
select public.calculate_upi_merchant_mdr(2000,'upi','2026-10-15 00:00:00+05:30',null,true) = 0 as at_threshold;
select public.calculate_upi_merchant_mdr(2000.01,'upi','2026-10-15 00:00:00+05:30',null,true) = 8.00 as above_threshold;
rollback;

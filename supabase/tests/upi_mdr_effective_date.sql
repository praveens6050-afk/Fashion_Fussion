begin;
select public.calculate_upi_merchant_mdr(5000,'upi','2026-10-14 23:59:59+05:30',null,true) = 0 as one_second_before;
select public.calculate_upi_merchant_mdr(5000,'upi','2026-10-15 00:00:00+05:30',null,true) = 20 as at_effective_time;
rollback;

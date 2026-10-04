begin;
select public.calculate_upi_merchant_mdr(74999,'upi','2026-10-15 00:00:00+05:30',null,true) = 300 as rounded_near_cap;
select public.calculate_upi_merchant_mdr(75000,'upi','2026-10-15 00:00:00+05:30',null,true) = 300 as exact_cap_amount;
select public.calculate_upi_merchant_mdr(1000000,'upi','2026-10-15 00:00:00+05:30',null,true) = 300 as hard_cap;
rollback;

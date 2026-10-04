begin;
select public.calculate_upi_merchant_mdr(74999.99,'upi','2026-10-15 00:00:00+05:30',null,true) <= 300 as below_cap_boundary;
select public.calculate_upi_merchant_mdr(75000,'upi','2026-10-15 00:00:00+05:30',null,true) = 300 as cap_boundary;
rollback;

begin;
select public.calculate_upi_merchant_mdr(10000,'upi','2026-10-15 00:00:00+05:30',null,false) = 0 as explicit_exemption;
select public.calculate_upi_merchant_mdr(10000,'upi','2026-10-15 00:00:00+05:30',null,true) = 40 as eligible_transaction;
rollback;

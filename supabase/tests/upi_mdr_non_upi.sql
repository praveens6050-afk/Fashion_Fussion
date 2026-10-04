begin;
select public.calculate_upi_merchant_mdr(10000,'card','2026-10-15 00:00:00+05:30',null,true) = 0 as card;
select public.calculate_upi_merchant_mdr(10000,'netbanking','2026-10-15 00:00:00+05:30',null,true) = 0 as netbanking;
select public.calculate_upi_merchant_mdr(10000,'cod','2026-10-15 00:00:00+05:30',null,true) = 0 as cod;
rollback;

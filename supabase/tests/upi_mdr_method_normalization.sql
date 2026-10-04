begin;
select public.calculate_upi_merchant_mdr(5000,'UPI','2026-10-15 00:00:00+05:30',null,true) = 20 as uppercase_upi;
select public.calculate_upi_merchant_mdr(5000,' upi ','2026-10-15 00:00:00+05:30',null,true) = 20 as trimmed_upi;
select public.calculate_upi_merchant_mdr(5000,'upi_intent','2026-10-15 00:00:00+05:30',null,true) = 20 as upi_intent;
select public.calculate_upi_merchant_mdr(5000,'upi_collect','2026-10-15 00:00:00+05:30',null,true) = 20 as upi_collect;
rollback;

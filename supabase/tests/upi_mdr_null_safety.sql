begin;
select public.calculate_upi_merchant_mdr(null,'upi','2026-10-15 00:00:00+05:30',null,true) = 0 as null_amount;
select public.calculate_upi_merchant_mdr(5000,null,'2026-10-15 00:00:00+05:30',null,true) = 0 as null_method;
select public.calculate_upi_merchant_mdr(5000,'upi',null,null,true) = 0 as null_paid_at;
rollback;

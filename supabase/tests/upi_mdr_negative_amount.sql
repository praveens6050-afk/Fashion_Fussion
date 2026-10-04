begin;
select public.calculate_upi_merchant_mdr(-5000,'upi','2026-10-15 00:00:00+05:30',null,true) = 0 as negative_amount_zero;
rollback;

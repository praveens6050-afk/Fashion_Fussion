-- Run after migrations in a disposable/test database.
begin;

select public.calculate_upi_merchant_mdr(2000,'upi','2026-10-15 00:00:00+05:30',null,true) = 0 as exactly_2000_free;
select public.calculate_upi_merchant_mdr(2000.01,'upi','2026-10-15 00:00:00+05:30',null,true) = 8.00 as above_2000_charged;
select public.calculate_upi_merchant_mdr(3000,'upi','2026-10-15 00:00:00+05:30',null,true) = 12 as amount_3000;
select public.calculate_upi_merchant_mdr(5000,'upi','2026-10-15 00:00:00+05:30',null,true) = 20 as amount_5000;
select public.calculate_upi_merchant_mdr(75000,'upi','2026-10-15 00:00:00+05:30',null,true) = 300 as cap_75000;
select public.calculate_upi_merchant_mdr(150000,'upi','2026-10-15 00:00:00+05:30',null,true) = 300 as cap_above_75000;
select public.calculate_upi_merchant_mdr(5000,'card','2026-10-15 00:00:00+05:30',null,true) = 0 as card_free;
select public.calculate_upi_merchant_mdr(5000,'upi','2026-10-14 23:59:59+05:30',null,true) = 0 as before_effective_date_free;
select public.calculate_upi_merchant_mdr(5000,'upi','2026-10-15 00:00:00+05:30',20,true) = 0 as provider_fee_prevents_double_charge;
select public.calculate_upi_merchant_mdr(5000,'upi','2026-10-15 00:00:00+05:30',null,false) = 0 as exempt_payment_free;

rollback;

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status = any (array[
    'creating'::text,
    'created'::text,
    'paid'::text,
    'cod_pending'::text,
    'cod_collected'::text,
    'cod_cancelled'::text,
    'payment_failed'::text,
    'expired'::text,
    'cancelled'::text,
    'refund_pending'::text,
    'refund_initiated'::text,
    'refund_failed'::text,
    'refunded'::text
  ]));

alter table public.orders
  drop constraint if exists orders_cod_flag_consistency_check;

alter table public.orders
  add constraint orders_cod_flag_consistency_check
  check (
    payment_method = 'cod'::text
    or (payment_method = 'prepaid'::text and cod_fee_non_refundable = false)
  );
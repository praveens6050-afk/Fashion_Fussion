alter table public.orders
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists refund_id text,
  add column if not exists refund_status text,
  add column if not exists refund_reference text,
  add column if not exists refund_amount numeric,
  add column if not exists refund_updated_at timestamptz;

alter table public.orders
  drop constraint if exists orders_refund_amount_nonnegative;

alter table public.orders
  add constraint orders_refund_amount_nonnegative
  check (refund_amount is null or refund_amount >= 0);

create index if not exists orders_refund_id_idx
  on public.orders (refund_id)
  where refund_id is not null;
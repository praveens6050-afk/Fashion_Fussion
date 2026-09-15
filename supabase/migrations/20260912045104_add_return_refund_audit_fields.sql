alter table public.return_requests
  add column if not exists refund_id text,
  add column if not exists refund_status text,
  add column if not exists refund_reference text,
  add column if not exists refund_amount numeric,
  add column if not exists refund_updated_at timestamptz;

alter table public.return_requests
  drop constraint if exists return_requests_refund_amount_check,
  add constraint return_requests_refund_amount_check check (refund_amount is null or refund_amount >= 0);

create unique index if not exists return_requests_refund_id_unique
  on public.return_requests(refund_id)
  where refund_id is not null;
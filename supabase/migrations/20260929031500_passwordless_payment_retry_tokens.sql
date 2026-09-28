alter table public.payment_recovery_notifications
  add column if not exists retry_token_hash text,
  add column if not exists retry_token_expires_at timestamptz,
  add column if not exists retry_token_consumed_at timestamptz;

create unique index if not exists payment_recovery_notifications_retry_token_hash_key
  on public.payment_recovery_notifications(retry_token_hash)
  where retry_token_hash is not null;

create index if not exists payment_recovery_notifications_retry_token_expiry_idx
  on public.payment_recovery_notifications(retry_token_expires_at)
  where retry_token_hash is not null;

revoke all on table public.payment_recovery_notifications from public, anon, authenticated;
grant select, insert, update on table public.payment_recovery_notifications to service_role;

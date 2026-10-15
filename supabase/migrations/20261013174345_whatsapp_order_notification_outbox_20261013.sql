create table if not exists public.whatsapp_order_notification_outbox (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  event_type text not null check(event_type in ('order_confirmed','shipped','out_for_delivery','delivered')),
  status text not null default 'pending_review' check(status in ('pending_review','blocked','ready','sending','accepted','delivered','failed')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 25),
  template_name text not null default 'order_status_update',
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_order_notification_once_per_order_event unique(order_id,event_type)
);
alter table public.whatsapp_order_notification_outbox enable row level security;
revoke all on table public.whatsapp_order_notification_outbox from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_order_notification_outbox to service_role;
grant usage,select on sequence public.whatsapp_order_notification_outbox_id_seq to service_role;
comment on table public.whatsapp_order_notification_outbox is 'Server-only future WhatsApp notification outbox. Unique per order/event. No trigger, cron job or sender is enabled.';

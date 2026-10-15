
create table if not exists public.whatsapp_delivery_status_events (
  id bigint generated always as identity primary key,
  provider_message_id text not null check (length(provider_message_id) between 5 and 255),
  meta_status text not null check(meta_status in ('sent','delivered','read','failed')),
  event_at timestamptz not null,
  error_code text check(error_code is null or length(error_code) <= 64),
  created_at timestamptz not null default now(),
  constraint whatsapp_delivery_status_event_unique unique(provider_message_id,meta_status,event_at)
);
create index if not exists whatsapp_delivery_status_events_message_idx
  on public.whatsapp_delivery_status_events(provider_message_id,event_at desc);
alter table public.whatsapp_delivery_status_events enable row level security;
revoke all on public.whatsapp_delivery_status_events from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_delivery_status_events to service_role;
grant usage,select on sequence public.whatsapp_delivery_status_events_id_seq to service_role;

alter table public.whatsapp_order_notification_outbox
 add column if not exists provider_sent_at timestamptz,
 add column if not exists provider_delivered_at timestamptz,
 add column if not exists provider_read_at timestamptz,
 add column if not exists provider_failed_at timestamptz,
 add column if not exists last_provider_status text;
create unique index if not exists whatsapp_order_outbox_provider_message_unique
 on public.whatsapp_order_notification_outbox(provider_message_id)
 where provider_message_id is not null;

create or replace function public.record_whatsapp_delivery_status(
  p_provider_message_id text, p_meta_status text, p_event_at timestamptz, p_error_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_new_event integer := 0;
  v_matched integer := 0;
begin
  if p_provider_message_id is null
     or length(p_provider_message_id) not between 5 and 255
     or p_provider_message_id !~ '^wamid[.]'
     or p_meta_status not in ('sent','delivered','read','failed')
     or p_event_at is null
     or p_event_at > now() + interval '5 minutes'
     or p_event_at < timestamp with time zone '2020-01-01'
     or length(coalesce(p_error_code,'')) > 64
  then raise exception 'Invalid WhatsApp delivery status event' using errcode='22023';
  end if;
  insert into public.whatsapp_delivery_status_events
    (provider_message_id,meta_status,event_at,error_code)
  values (p_provider_message_id,p_meta_status,p_event_at,p_error_code)
  on conflict (provider_message_id,meta_status,event_at) do nothing;
  get diagnostics v_new_event = row_count;
  if v_new_event = 0 then
    return jsonb_build_object('recorded',false,'duplicate',true,'matched_order',false);
  end if;

  update public.whatsapp_order_notification_outbox o set
    provider_sent_at = case when p_meta_status = 'sent'
      then greatest(o.provider_sent_at,p_event_at) else o.provider_sent_at end,
    provider_delivered_at = case when p_meta_status in ('delivered','read')
      then greatest(o.provider_delivered_at,p_event_at) else o.provider_delivered_at end,
    provider_read_at = case when p_meta_status = 'read'
      then greatest(o.provider_read_at,p_event_at) else o.provider_read_at end,
    provider_failed_at = case when p_meta_status = 'failed'
      then greatest(o.provider_failed_at,p_event_at) else o.provider_failed_at end,
    last_provider_status = case
      when p_meta_status = 'read' then 'read'
      when p_meta_status = 'delivered' then
        case when o.last_provider_status = 'read' then 'read' else 'delivered' end
      when p_meta_status = 'sent' then
        case when o.last_provider_status in ('delivered','read','failed')
          then o.last_provider_status else 'sent' end
      when p_meta_status = 'failed' then
        case when o.last_provider_status in ('delivered','read')
          then o.last_provider_status else 'failed' end
      end,
    status = case
      when p_meta_status in ('delivered','read') then 'delivered'
      when p_meta_status = 'failed' and o.status not in ('delivered') then 'failed'
      when p_meta_status = 'sent' and o.status in ('sending','accepted') then 'accepted'
      else o.status end,
    last_error_code = case when p_meta_status = 'failed' and o.status <> 'delivered'
      then p_error_code else o.last_error_code end,
    updated_at = now()
  where o.provider_message_id = p_provider_message_id;
  get diagnostics v_matched = row_count;
  return jsonb_build_object('recorded',true,'duplicate',false,'matched_order',v_matched=1);
end;
$fn$;

revoke all on function public.record_whatsapp_delivery_status(text,text,timestamptz,text)
 from public,anon,authenticated;
grant execute on function public.record_whatsapp_delivery_status(text,text,timestamptz,text)
 to service_role;
comment on function public.record_whatsapp_delivery_status(text,text,timestamptz,text) is
 'Idempotent Meta HMAC-verified delivery receipt recorder. OTP/non-outbox delivery statuses are also tracked; never sends messages.';

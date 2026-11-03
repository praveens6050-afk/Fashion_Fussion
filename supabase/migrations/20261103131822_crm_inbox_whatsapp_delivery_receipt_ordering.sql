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
  v_crm_matched integer := 0;
  v_crm_delivery_status text;
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
  -- Re-apply duplicate receipts so a message logged after the first receipt can
  -- still receive its status. The event ledger remains idempotent.

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

  update public.crm_inbox_messages m set
    delivery_status = case
      when m.delivery_status in ('read','failed','delivered') then
        case when m.delivery_status='delivered' and p_meta_status='read' then 'read' else m.delivery_status end
      when p_meta_status='read' then 'read'
      when p_meta_status='failed' then 'failed'
      when p_meta_status='delivered' then 'delivered'
      else 'sent'
    end,
    metadata = coalesce(m.metadata,'{}'::jsonb) || jsonb_build_object(
      'meta_delivery_status',p_meta_status,
      'meta_status_timestamp',extract(epoch from p_event_at)::bigint::text,
      'meta_status_errors',case when p_error_code is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code',p_error_code)) end
    )
  where m.provider_message_id=p_provider_message_id
    and m.direction='outbound'
    and (
      case when coalesce(m.metadata->>'meta_status_timestamp','') ~ '^[0-9]+$'
        then to_timestamp((m.metadata->>'meta_status_timestamp')::double precision) <= p_event_at
        else true end
    )
    and case m.delivery_status
      when 'read' then p_meta_status='read'
      when 'failed' then p_meta_status='failed'
      when 'delivered' then p_meta_status in ('delivered','read')
      else true
    end;
  get diagnostics v_crm_matched = row_count;

  select m.delivery_status into v_crm_delivery_status
  from public.crm_inbox_messages m
  where m.provider_message_id=p_provider_message_id and m.direction='outbound'
  limit 1;
  v_crm_matched := case when v_crm_delivery_status is not null then 1 else 0 end;

  return jsonb_build_object(
    'recorded',v_new_event=1,
    'duplicate',v_new_event=0,
    'matched_order',v_matched=1,
    'matched_crm_message',v_crm_matched=1,
    'crm_delivery_status',v_crm_delivery_status
  );
end;
$fn$;
REVOKE ALL ON FUNCTION public.record_whatsapp_delivery_status(text,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_delivery_status(text,text,timestamptz,text)
  TO service_role;
COMMENT ON FUNCTION public.record_whatsapp_delivery_status(text,text,timestamptz,text) IS
  'Idempotent Meta HMAC-verified delivery receipt recorder for orders and CRM inbox messages; never sends messages.';

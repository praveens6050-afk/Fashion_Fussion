-- Read-only, admin-only notification diagnostics for the standalone CRM.
-- No message body, recipient address, phone, OTP hash, access token, or raw provider response is returned.
begin;

create or replace function public.admin_crm_notification_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select coalesce(p.is_admin, false)
    into v_is_admin
  from public.profiles p
  where p.id = v_uid;

  if not coalesce(v_is_admin, false) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'email', jsonb_build_object(
      'counts', (select jsonb_build_object(
        'total', count(*),
        'sent', count(*) filter (where status = 'sent'),
        'pending', count(*) filter (where status in ('pending','queued','processing')),
        'failed', count(*) filter (where status in ('failed','blocked'))
      ) from public.zoho_order_email_outbox),
      'recent', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (
          select id, order_id, event_type, provider, status, attempt_count,
                 last_error_code, last_attempt_at, sent_at, created_at, updated_at
          from public.zoho_order_email_outbox
          order by created_at desc
          limit 100
        ) t), '[]'::jsonb)
    ),
    'whatsapp', jsonb_build_object(
      'counts', (select jsonb_build_object(
        'total', count(*),
        'sent', count(*) filter (where status in ('sent','accepted','delivered','read')),
        'pending', count(*) filter (where status in ('pending','queued','processing')),
        'failed', count(*) filter (where status in ('failed','blocked'))
      ) from public.whatsapp_order_notification_outbox),
      'recent', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (
          select id, order_id, event_type, status, attempt_count, template_name,
                 last_error_code, last_provider_status, provider_sent_at,
                 provider_delivered_at, provider_read_at, provider_failed_at,
                 created_at, updated_at
          from public.whatsapp_order_notification_outbox
          order by created_at desc
          limit 100
        ) t), '[]'::jsonb)
    ),
    'payment_recovery', jsonb_build_object(
      'counts', (select jsonb_build_object(
        'total', count(*),
        'sent', count(*) filter (where status = 'sent'),
        'pending', count(*) filter (where status in ('pending','queued','processing')),
        'failed', count(*) filter (where status in ('failed','blocked'))
      ) from public.payment_recovery_notifications),
      'recent', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (
          select id, order_id, event_type, provider, status, attempt_count,
                 (last_error is not null) as has_error, last_attempt_at, sent_at, created_at
          from public.payment_recovery_notifications
          order by created_at desc
          limit 100
        ) t), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.admin_crm_notification_snapshot() from public, anon;
grant execute on function public.admin_crm_notification_snapshot() to authenticated;

commit;


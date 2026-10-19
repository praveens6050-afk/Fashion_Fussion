-- Isolated CI assertion for the private admin WhatsApp alert registry.
DO $test$
DECLARE
  recipient_rls boolean;
  outbox_rls boolean;
BEGIN
  SELECT c.relrowsecurity INTO recipient_rls
  FROM pg_catalog.pg_class c WHERE c.oid='public.whatsapp_admin_alert_recipients'::regclass;
  SELECT c.relrowsecurity INTO outbox_rls
  FROM pg_catalog.pg_class c WHERE c.oid='public.whatsapp_admin_alert_outbox'::regclass;
  IF recipient_rls IS DISTINCT FROM true OR outbox_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin WhatsApp tables must enforce RLS';
  END IF;
  IF has_table_privilege('anon','public.whatsapp_admin_alert_recipients','SELECT')
     OR has_table_privilege('authenticated','public.whatsapp_admin_alert_recipients','SELECT')
     OR has_table_privilege('anon','public.whatsapp_admin_alert_outbox','SELECT')
     OR has_table_privilege('authenticated','public.whatsapp_admin_alert_outbox','SELECT') THEN
    RAISE EXCEPTION 'Browser roles must not read admin recipients or outbox';
  END IF;
  IF NOT has_table_privilege('service_role','public.whatsapp_admin_alert_recipients','SELECT')
     OR NOT has_table_privilege('service_role','public.whatsapp_admin_alert_outbox','INSERT') THEN
    RAISE EXCEPTION 'Service role must have private operational access';
  END IF;
  IF has_function_privilege('anon','public.stage_whatsapp_admin_alert(text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.stage_whatsapp_admin_alert(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser roles must not stage admin alerts';
  END IF;
  IF NOT has_function_privilege('service_role','public.stage_whatsapp_admin_alert(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Service role must stage admin alerts';
  END IF;
  IF public.stage_whatsapp_admin_alert('order:123456','order_attention','ORD-123') <> 0 THEN
    RAISE EXCEPTION 'No admin recipients are configured in the isolated fixture';
  END IF;
  IF public.stage_whatsapp_admin_alert('short','order_attention','ORD-123') <> 0 THEN
    RAISE EXCEPTION 'Invalid event keys must fail closed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.whatsapp_admin_alert_outbox'::regclass
      AND contype='u'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%recipient_id, event_key%'
  ) THEN
    RAISE EXCEPTION 'Outbox requires recipient/event idempotency constraint';
  END IF;
END
$test$;

-- Verify notification-only data and trigger RPC privileges are least-privilege.
DO $test$
BEGIN
  IF has_table_privilege('anon','public.whatsapp_inbound_events','SELECT')
     OR has_table_privilege('anon','public.whatsapp_inbound_events','INSERT')
     OR has_table_privilege('authenticated','public.whatsapp_inbound_events','SELECT')
     OR has_table_privilege('authenticated','public.whatsapp_inbound_events','INSERT') THEN
    RAISE EXCEPTION 'WhatsApp inbound messages must not be accessible to browser roles';
  END IF;
  IF has_sequence_privilege('anon','public.whatsapp_inbound_events_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.whatsapp_inbound_events_id_seq','USAGE') THEN
    RAISE EXCEPTION 'WhatsApp inbound identity sequence must not be accessible to browser roles';
  END IF;
  IF has_function_privilege('anon','public.stage_zoho_email_on_order_insert()','EXECUTE')
     OR has_function_privilege('authenticated','public.stage_zoho_email_on_order_insert()','EXECUTE') THEN
    RAISE EXCEPTION 'Trigger-only Zoho staging function must not be exposed as RPC';
  END IF;
  IF NOT has_table_privilege('service_role','public.whatsapp_inbound_events','INSERT')
     OR NOT has_sequence_privilege('service_role','public.whatsapp_inbound_events_id_seq','USAGE')
     OR NOT has_function_privilege('service_role','public.stage_zoho_email_on_order_insert()','EXECUTE') THEN
    RAISE EXCEPTION 'Service-role notification processing privileges were not preserved';
  END IF;
END
$test$;

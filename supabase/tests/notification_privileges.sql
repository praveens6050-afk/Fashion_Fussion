-- Notification webhook storage and trigger-only functions must be backend-only.
BEGIN;
SELECT plan(9);

SELECT ok(
  NOT has_table_privilege('anon','public.whatsapp_inbound_events','SELECT'),
  'anon cannot read inbound WhatsApp messages'
);
SELECT ok(
  NOT has_table_privilege('anon','public.whatsapp_inbound_events','INSERT'),
  'anon cannot insert inbound WhatsApp messages'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.whatsapp_inbound_events','SELECT'),
  'authenticated users cannot read inbound WhatsApp messages'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.whatsapp_inbound_events','INSERT'),
  'authenticated users cannot insert inbound WhatsApp messages'
);
SELECT ok(
  NOT has_sequence_privilege('anon','public.whatsapp_inbound_events_id_seq','USAGE'),
  'anon cannot use inbound message identity sequence'
);
SELECT ok(
  NOT has_sequence_privilege('authenticated','public.whatsapp_inbound_events_id_seq','USAGE'),
  'authenticated users cannot use inbound message identity sequence'
);
SELECT ok(
  NOT has_function_privilege('anon','public.stage_zoho_email_on_order_insert()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.stage_zoho_email_on_order_insert()','EXECUTE'),
  'trigger-only Zoho staging function is not exposed as RPC'
);
SELECT ok(
  has_table_privilege('service_role','public.whatsapp_inbound_events','INSERT')
  AND has_sequence_privilege('service_role','public.whatsapp_inbound_events_id_seq','USAGE')
  AND has_function_privilege('service_role','public.stage_zoho_email_on_order_insert()','EXECUTE'),
  'service_role retains required notification processing privileges'
);
SELECT ok(
  to_regclass('public.whatsapp_inbound_events_sender_user_id_idx') IS NOT NULL,
  'inbound sender foreign key has a covering index'
);

SELECT * FROM finish();
ROLLBACK;

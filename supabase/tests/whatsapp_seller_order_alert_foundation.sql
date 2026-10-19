-- Isolated CI assertion for seller order-alert privacy and safe routing.
DO $test$
DECLARE
  rls boolean;
BEGIN
  SELECT c.relrowsecurity INTO rls
  FROM pg_catalog.pg_class c
  WHERE c.oid='public.whatsapp_seller_order_notification_outbox'::regclass;
  IF rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Seller order alert outbox must enforce RLS';
  END IF;
  IF has_table_privilege('anon','public.whatsapp_seller_order_notification_outbox','SELECT')
     OR has_table_privilege('authenticated','public.whatsapp_seller_order_notification_outbox','SELECT') THEN
    RAISE EXCEPTION 'Browser roles must not read seller notification outbox';
  END IF;
  IF NOT has_table_privilege('service_role','public.whatsapp_seller_order_notification_outbox','INSERT') THEN
    RAISE EXCEPTION 'Service role must have outbox insert access';
  END IF;
  IF has_function_privilege('anon','public.stage_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE')
     OR has_function_privilege('authenticated','public.stage_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser roles must not stage seller alerts';
  END IF;
  IF NOT has_function_privilege('service_role','public.stage_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE') THEN
    RAISE EXCEPTION 'Service role must stage seller alerts';
  END IF;
  IF public.stage_whatsapp_seller_order_alert(1,now()-interval '1 hour') <> 0 THEN
    RAISE EXCEPTION 'Nonexistent/unmapped orders must not stage seller alerts';
  END IF;
END
$test$;

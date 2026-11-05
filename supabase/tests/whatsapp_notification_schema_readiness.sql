-- Isolated CI assertion for the read-only schema readiness RPC.
DO $test$
DECLARE report jsonb;
BEGIN
  report := public.whatsapp_notification_schema_readiness();
  IF report->>'schemaVerified' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Expected verified schema in isolated fixture, got %', report;
  END IF;
  IF report->>'sendingAuthorized' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Readiness probe must never authorize sending: %', report;
  END IF;
  IF has_function_privilege('anon',
      'public.whatsapp_notification_schema_readiness()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute readiness RPC';
  END IF;
  IF has_function_privilege('authenticated',
      'public.whatsapp_notification_schema_readiness()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute readiness RPC';
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.whatsapp_notification_schema_readiness()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute readiness RPC';
  END IF;
END
$test$;

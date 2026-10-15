-- Fashion Fussion WhatsApp pre-launch audit, READ ONLY.
-- Execute as a SELECT on a dedicated STAGING database after reviewed SQL migration.
-- This script does not stage an order, claim an event, edit a flag, send a Meta
-- message, invoke an RPC, insert test data or touch Zoho Mail.
-- Never treat success here as template approval, Meta connectivity or inbox delivery.
WITH rpc AS (
  SELECT
    pg_catalog.to_regprocedure('public.claim_whatsapp_order_confirmation(bigint,timestamptz)') AS claim_oid,
    pg_catalog.to_regprocedure('public.finish_whatsapp_order_confirmation(bigint,text,text)') AS finish_oid,
    pg_catalog.to_regprocedure('public.stage_whatsapp_order_event(bigint,text)') AS stage_oid
),
checks AS (
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='whatsapp_order_notification_outbox'
        AND column_name='attempt_started_at'
        AND data_type='timestamp with time zone'
    ) AS attempt_started_at_column,
    (SELECT claim_oid IS NOT NULL FROM rpc) AS claim_rpc_present,
    (SELECT finish_oid IS NOT NULL FROM rpc) AS finish_rpc_present,
    COALESCE((SELECT p.prosecdef FROM pg_catalog.pg_proc p, rpc WHERE p.oid=rpc.claim_oid),false)
      AS claim_rpc_security_definer,
    COALESCE((SELECT p.prosecdef FROM pg_catalog.pg_proc p, rpc WHERE p.oid=rpc.finish_oid),false)
      AS finish_rpc_security_definer,
    COALESCE((SELECT pg_catalog.has_function_privilege('service_role',claim_oid,'EXECUTE')
      FROM rpc WHERE claim_oid IS NOT NULL),false) AS claim_service_role_access,
    COALESCE((SELECT pg_catalog.has_function_privilege('service_role',finish_oid,'EXECUTE')
      FROM rpc WHERE finish_oid IS NOT NULL),false) AS finish_service_role_access,
    COALESCE((SELECT pg_catalog.has_function_privilege('anon',claim_oid,'EXECUTE')
      FROM rpc WHERE claim_oid IS NOT NULL),false) AS claim_anon_access,
    COALESCE((SELECT pg_catalog.has_function_privilege('authenticated',claim_oid,'EXECUTE')
      FROM rpc WHERE claim_oid IS NOT NULL),false) AS claim_authenticated_access,
    COALESCE((SELECT pg_catalog.has_function_privilege('anon',finish_oid,'EXECUTE')
      FROM rpc WHERE finish_oid IS NOT NULL),false) AS finish_anon_access,
    COALESCE((SELECT pg_catalog.has_function_privilege('authenticated',finish_oid,'EXECUTE')
      FROM rpc WHERE finish_oid IS NOT NULL),false) AS finish_authenticated_access,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid='public.whatsapp_order_notification_outbox'::regclass
        AND c.contype='u'
        AND pg_catalog.pg_get_constraintdef(c.oid) ILIKE '%UNIQUE (order_id, event_type)%'
    ) AS order_event_uniqueness,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgname='trg_stage_whatsapp_order_on_change'
        AND t.tgrelid='public.orders'::regclass
        AND t.tgenabled IN ('O','A')
    ) AS stage_on_order_change_enabled,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgname='trg_stage_whatsapp_order_on_consent'
        AND t.tgrelid='public.whatsapp_order_consents'::regclass
        AND t.tgenabled IN ('O','A')
    ) AS stage_on_consent_enabled,
    (SELECT COUNT(*) FROM public.whatsapp_order_notification_outbox) AS outbox_count,
    (SELECT COUNT(*) FROM public.whatsapp_order_notification_outbox
       WHERE attempt_count>0 OR provider_message_id IS NOT NULL) AS already_attempted_count,
    (SELECT COUNT(*) FROM public.whatsapp_order_notification_outbox
       WHERE status='pending_review') AS pending_review_count
)
SELECT *, (
  attempt_started_at_column AND claim_rpc_present AND finish_rpc_present
  AND claim_rpc_security_definer AND finish_rpc_security_definer
  AND claim_service_role_access AND finish_service_role_access
  AND NOT claim_anon_access AND NOT claim_authenticated_access
  AND NOT finish_anon_access AND NOT finish_authenticated_access
  AND order_event_uniqueness AND stage_on_order_change_enabled
  AND stage_on_consent_enabled
) AS schema_and_grants_ready_for_controlled_staging_test
FROM checks;

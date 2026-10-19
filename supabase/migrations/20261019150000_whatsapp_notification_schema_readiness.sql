-- Read-only readiness probe for the deployed customer order-confirmation pipeline.
-- Does not enable sending, enqueue notifications, modify consent, or expose recipient data.
CREATE OR REPLACE FUNCTION public.whatsapp_notification_schema_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  missing_columns text[];
  claim_exists boolean;
  finish_exists boolean;
  seller_mapping_missing text[];
  seller_recipient_missing text[];
  admin_identity_missing text[];
  admin_alert_storage_missing text[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
  FROM (VALUES
    ('whatsapp_order_notification_outbox','id'),
    ('whatsapp_order_notification_outbox','order_id'),
    ('whatsapp_order_notification_outbox','event_type'),
    ('whatsapp_order_notification_outbox','status'),
    ('whatsapp_order_notification_outbox','attempt_count'),
    ('whatsapp_order_notification_outbox','template_name'),
    ('whatsapp_order_notification_outbox','provider_message_id'),
    ('whatsapp_order_notification_outbox','attempt_started_at'),
    ('whatsapp_order_consents','order_id'),
    ('whatsapp_order_consents','user_id'),
    ('whatsapp_order_consents','phone_e164'),
    ('whatsapp_order_consents','consented_at'),
    ('whatsapp_order_consents','revoked_at'),
    ('whatsapp_contact_consents','phone_e164'),
    ('whatsapp_contact_consents','purpose'),
    ('whatsapp_contact_consents','status'),
    ('whatsapp_contact_consents','consented_at'),
    ('whatsapp_contact_consents','revoked_at'),
    ('orders','id'),
    ('orders','user_id'),
    ('orders','customer_phone'),
    ('orders','payment_verified_at'),
    ('orders','fulfillment_status')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name=required.table_name
      AND c.column_name=required.column_name
  );

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO seller_mapping_missing
  FROM (VALUES
    ('seller_product_submissions','seller_id'),
    ('seller_product_submissions','approved_product_id'),
    ('seller_product_submissions','status'),
    ('products','id'),
    ('product_variants','id'),
    ('product_variants','product_id')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=required.table_name
      AND c.column_name=required.column_name
  );

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO seller_recipient_missing
  FROM (VALUES
    ('seller_profiles','user_id'),
    ('seller_profiles','phone'),
    ('seller_profiles','phone_verified_at'),
    ('seller_profiles','status'),
    ('whatsapp_contact_consents','phone_e164'),
    ('whatsapp_contact_consents','purpose'),
    ('whatsapp_contact_consents','status'),
    ('whatsapp_contact_consents','consented_at'),
    ('whatsapp_contact_consents','revoked_at')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=required.table_name
      AND c.column_name=required.column_name
  );

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO admin_identity_missing
  FROM (VALUES
    ('profiles','id'),('profiles','phone'),('profiles','phone_verified_at'),
    ('profiles','is_admin')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=required.table_name
      AND c.column_name=required.column_name
  );

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO admin_alert_storage_missing
  FROM (VALUES
    ('whatsapp_admin_alert_recipients','user_id'),
    ('whatsapp_admin_alert_recipients','phone_e164'),
    ('whatsapp_admin_alert_recipients','verified_at'),
    ('whatsapp_admin_alert_recipients','enabled'),
    ('whatsapp_admin_alert_outbox','recipient_id'),
    ('whatsapp_admin_alert_outbox','event_key'),
    ('whatsapp_admin_alert_outbox','alert_type'),
    ('whatsapp_admin_alert_outbox','reference_code'),
    ('whatsapp_admin_alert_outbox','status'),
    ('whatsapp_admin_alert_outbox','attempt_count'),
    ('whatsapp_admin_alert_outbox','provider_message_id')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=required.table_name
      AND c.column_name=required.column_name
  );

  claim_exists := pg_catalog.to_regprocedure(
    'public.claim_whatsapp_order_confirmation(bigint,timestamp with time zone)'
  ) IS NOT NULL;
  finish_exists := pg_catalog.to_regprocedure(
    'public.finish_whatsapp_order_confirmation(bigint,text,text)'
  ) IS NOT NULL;

  RETURN pg_catalog.jsonb_build_object(
    'readOnly', true,
    'schemaVerified', coalesce(pg_catalog.cardinality(missing_columns),0)=0
      AND claim_exists AND finish_exists,
    'missingColumns', coalesce(to_jsonb(missing_columns),'[]'::jsonb),
    'claimFunctionPresent', claim_exists,
    'finishFunctionPresent', finish_exists,
    'sendingAuthorized', false,
    'sellerMappingSchemaVerified', coalesce(pg_catalog.cardinality(seller_mapping_missing),0)=0,
    'sellerMappingMissingColumns', coalesce(to_jsonb(seller_mapping_missing),'[]'::jsonb),
    'sellerRecipientSchemaVerified', coalesce(pg_catalog.cardinality(seller_recipient_missing),0)=0,
    'sellerRecipientMissingColumns', coalesce(to_jsonb(seller_recipient_missing),'[]'::jsonb),
    'adminIdentitySchemaVerified', coalesce(pg_catalog.cardinality(admin_identity_missing),0)=0,
    'adminIdentityMissingColumns', coalesce(to_jsonb(admin_identity_missing),'[]'::jsonb),
    'adminAlertStorageVerified', coalesce(pg_catalog.cardinality(admin_alert_storage_missing),0)=0,
    'adminAlertStorageMissingColumns', coalesce(to_jsonb(admin_alert_storage_missing),'[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_notification_schema_readiness()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_notification_schema_readiness()
  TO service_role;

-- Run against a Supabase-compatible test database after migrations.
DO $$
DECLARE
  t text;
  server_only_tables text[] := ARRAY[
    'public.whatsapp_contact_consents',
    'public.whatsapp_consent_events',
    'public.whatsapp_order_consents',
    'public.whatsapp_order_notification_outbox',
    'public.whatsapp_delivery_status_events',
    'public.whatsapp_inbound_events',
    'public.zoho_order_email_outbox',
    'public.payment_recovery_notifications',
    'public.phone_otp_challenges',
    'public.auth_login_otp_challenges'
  ];
  p text;
BEGIN
  FOREACH t IN ARRAY server_only_tables LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('anon', t, p) THEN
        RAISE EXCEPTION 'anon unexpectedly has % on %', p, t;
      END IF;
      IF has_table_privilege('authenticated', t, p) THEN
        RAISE EXCEPTION 'authenticated unexpectedly has % on %', p, t;
      END IF;
    END LOOP;

    IF NOT has_table_privilege('service_role', t, 'SELECT')
       OR NOT has_table_privilege('service_role', t, 'INSERT')
       OR NOT has_table_privilege('service_role', t, 'UPDATE')
       OR NOT has_table_privilege('service_role', t, 'DELETE') THEN
      RAISE EXCEPTION 'service_role is missing required CRUD privilege on %', t;
    END IF;
  END LOOP;
END $$;

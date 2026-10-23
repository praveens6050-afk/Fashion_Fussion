-- Reassert private identity-sequence privileges using PostgreSQL's actual sequence name.
-- This migration is for the crm-development branch and is validated in disposable CI only.
BEGIN;

DO $migration$
DECLARE
  v_sequence text := pg_catalog.pg_get_serial_sequence('public.crm_email_inbound_events', 'id');
BEGIN
  IF v_sequence IS NULL THEN
    RAISE EXCEPTION 'CRM email inbox identity sequence is missing';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
    v_sequence
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE, SELECT ON SEQUENCE %s TO service_role',
    v_sequence
  );
END;
$migration$;

COMMIT;

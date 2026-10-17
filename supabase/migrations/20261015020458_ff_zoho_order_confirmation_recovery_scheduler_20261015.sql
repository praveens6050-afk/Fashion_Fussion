-- Apply to the existing Fashion_Fussion Supabase project AFTER the Seller
-- recovery endpoint has deployed. Does not alter existing mail feature flags.
-- A missing vault secret makes every cron tick a harmless no-op.
-- Never insert credentials in GitHub, SQL migration files or chat.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION private.ff_zoho_order_recovery_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_recovery_token text;
BEGIN
  -- Store a matching >=40-character recovery-only token securely in the
  -- Supabase Vault UI as ff_zoho_recovery_token, and in Seller Cloudflare
  -- Production secrets as ZOHO_ORDER_RECOVERY_TOKEN.
  SELECT decrypted_secret INTO v_recovery_token
    FROM vault.decrypted_secrets
   WHERE name = 'ff_zoho_recovery_token'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_recovery_token IS NULL OR length(v_recovery_token) < 40 THEN
    RETURN;
  END IF;

  -- The fixed Cloudflare endpoint does ALL eligibility checks and reuses the
  -- atomic global, rate-limited claim. Never call the Zoho provider from SQL.
  PERFORM net.http_post(
    url := 'https://seller.fashionfussion.in/api/outreach/zoho-order-recovery',
    body := '{"recover":true}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || v_recovery_token
    ),
    timeout_milliseconds := 25000
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.ff_zoho_order_recovery_tick()
  FROM PUBLIC, anon, authenticated, service_role;

-- Runs every 5 minutes. Until the Vault token has been added, it only returns.
SELECT cron.schedule(
  'ff_zoho_order_recovery_every_5m',
  '*/5 * * * *',
  'SELECT private.ff_zoho_order_recovery_tick()'
);

-- Review status without exposing any token:
-- SELECT jobid, jobname, schedule, active FROM cron.job
-- WHERE jobname = 'ff_zoho_order_recovery_every_5m';
-- SELECT status, start_time, end_time FROM cron.job_run_details
-- WHERE jobid = (SELECT jobid FROM cron.job
--   WHERE jobname = 'ff_zoho_order_recovery_every_5m')
-- ORDER BY start_time DESC LIMIT 10;
-- To pause recovery ONLY (not normal order emails):
-- SELECT cron.unschedule('ff_zoho_order_recovery_every_5m');

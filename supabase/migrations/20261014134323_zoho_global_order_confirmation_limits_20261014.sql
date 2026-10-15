-- Launch-only, fail-closed *aggregate* safety limits for broad Zoho Orders mail.
-- Does not modify any order, send email or change legacy claim privileges.
CREATE OR REPLACE FUNCTION public.claim_zoho_order_confirmation_global_limited(p_order_id bigint)
RETURNS TABLE(outbox_id bigint, confirmed_order_id bigint, reference text,
              buyer_name text, buyer_email text, payment_method text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_last_hour bigint;
  v_last_day bigint;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN RETURN; END IF;
  -- Serialize quota check + atomic claim across parallel Cloudflare requests.
  PERFORM pg_catalog.pg_advisory_xact_lock(472921, 20261014);
  SELECT count(*) INTO v_last_hour
    FROM public.zoho_order_email_outbox ob
   WHERE ob.event_type='order_confirmed' AND ob.provider='zoho_mail'
     AND ob.attempt_count > 0
     AND ob.last_attempt_at >= now() - interval '1 hour';
  SELECT count(*) INTO v_last_day
    FROM public.zoho_order_email_outbox ob
   WHERE ob.event_type='order_confirmed' AND ob.provider='zoho_mail'
     AND ob.attempt_count > 0
     AND ob.last_attempt_at >= now() - interval '24 hours';
  -- Conservative initial quotas: leave extra unclaimed for supervised review.
  IF v_last_hour >= 30 OR v_last_day >= 150 THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.claim_zoho_order_confirmation(p_order_id);
END $function$;
REVOKE ALL ON FUNCTION public.claim_zoho_order_confirmation_global_limited(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_zoho_order_confirmation_global_limited(bigint)
  TO service_role;
COMMENT ON FUNCTION public.claim_zoho_order_confirmation_global_limited(bigint) IS
 'Service-only global send claim, serialized quota of 30/hour and 150/24h; unknown or sent emails never retried.';

CREATE OR REPLACE FUNCTION public.zoho_order_delivery_telemetry()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
   'provider','zoho_mail',
   'pendingReview',count(*) FILTER (WHERE status='pending_review'),
   'ready',count(*) FILTER (WHERE status='ready'),
   'sending',count(*) FILTER (WHERE status='sending'),
   'sent',count(*) FILTER (WHERE status='sent'),
   'blocked',count(*) FILTER (WHERE status='blocked'),
   'stalePending10m',count(*) FILTER (WHERE status IN ('pending_review','ready')
     AND attempt_count=0 AND created_at < now()-interval '10 minutes'
     AND created_at >= now()-interval '24 hours'),
   'stuckSending5m',count(*) FILTER (WHERE status='sending'
     AND updated_at < now()-interval '5 minutes'),
   'attemptsLastHour',count(*) FILTER (WHERE attempt_count>0
     AND last_attempt_at >= now()-interval '1 hour'),
   'attemptsLast24h',count(*) FILTER (WHERE attempt_count>0
     AND last_attempt_at >= now()-interval '24 hours'),
   'hourlyAttemptCap',30,
   'rolling24hAttemptCap',150
 ) FROM public.zoho_order_email_outbox
 WHERE event_type='order_confirmed' AND provider='zoho_mail'
$function$;
REVOKE ALL ON FUNCTION public.zoho_order_delivery_telemetry()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zoho_order_delivery_telemetry()
  TO service_role;
COMMENT ON FUNCTION public.zoho_order_delivery_telemetry() IS
 'Read-only aggregate Zoho confirmation queue/dispatch alerts without buyer or order PII.';

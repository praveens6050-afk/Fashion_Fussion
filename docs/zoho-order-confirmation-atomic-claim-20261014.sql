-- Safe, atomic single-attempt transport for order confirmations.
-- Does not approve events, dispatch emails, install cron, backfill or trigger sends.
-- Only service_role may run these server-side functions.
CREATE OR REPLACE FUNCTION public.claim_zoho_order_confirmation(p_order_id bigint)
RETURNS TABLE(
  outbox_id bigint,
  confirmed_order_id bigint,
  reference text,
  buyer_name text,
  buyer_email text,
  payment_method text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.zoho_order_email_outbox AS ob
       SET status='sending',
           attempt_count=ob.attempt_count+1,
           last_attempt_at=now(),
           updated_at=now()
      FROM public.orders AS ord
      JOIN auth.users AS buyer ON buyer.id=ord.user_id
     WHERE ob.order_id=ord.id
       AND ord.id=p_order_id
       AND ob.event_type='order_confirmed'
       AND ob.provider='zoho_mail'
       AND ob.status='ready'
       AND ob.attempt_count=0
       AND ob.sent_at IS NULL
       AND ob.provider_message_id IS NULL
       AND ob.created_at BETWEEN now()-interval '24 hours' AND now()
       AND ord.created_at BETWEEN now()-interval '24 hours' AND now()+interval '5 minutes'
       AND ord.fulfillment_status <> 'cancelled'
       AND buyer.email_confirmed_at IS NOT NULL
       AND lower(btrim(buyer.email))=lower(btrim(ord.customer_email))
       AND nullif(btrim(ord.customer_email),'') IS NOT NULL
       AND nullif(btrim(ord.customer_name),'') IS NOT NULL
       AND nullif(btrim(ord.display_order_id),'') IS NOT NULL
       AND (
         (ord.payment_method='prepaid'
            AND ord.status='paid' AND ord.payment_verified_at IS NOT NULL)
         OR
         (ord.payment_method='cod'
            AND ord.status IN ('cod_pending','cod_collected'))
       )
    RETURNING ob.id,ord.id,ord.display_order_id,ord.customer_name,ord.customer_email,ord.payment_method;
END
$function$;

REVOKE ALL ON FUNCTION public.claim_zoho_order_confirmation(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_zoho_order_confirmation(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_zoho_order_confirmation(
  p_outbox_id bigint,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_count integer;
BEGIN
  IF p_outbox_id IS NULL OR p_outbox_id<=0
    OR p_outcome NOT IN ('accepted','unknown','rejected') THEN RETURN false; END IF;

  UPDATE public.zoho_order_email_outbox AS ob
     SET status=CASE WHEN p_outcome='accepted' THEN 'sent' ELSE 'blocked' END,
         provider_message_id=CASE WHEN p_outcome='accepted'
            THEN nullif(left(btrim(coalesce(p_provider_message_id,'')),180),'')
            ELSE NULL END,
         last_error_code=CASE WHEN p_outcome='accepted' THEN NULL
              WHEN p_outcome='unknown' THEN 'PROVIDER_OUTCOME_UNKNOWN'
              ELSE 'PROVIDER_NOT_ACCEPTED' END,
         sent_at=CASE WHEN p_outcome='accepted' THEN now() ELSE NULL END,
         updated_at=now()
   WHERE ob.id=p_outbox_id
     AND ob.event_type='order_confirmed'
     AND ob.provider='zoho_mail'
     AND ob.status='sending'
     AND ob.attempt_count=1
     AND ob.sent_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count=1;
END
$function$;

REVOKE ALL ON FUNCTION public.finish_zoho_order_confirmation(bigint,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_zoho_order_confirmation(bigint,text,text) TO service_role;

COMMENT ON FUNCTION public.claim_zoho_order_confirmation(bigint) IS
 'Atomic claim of service-approved ready order_confirmed event, once only; no external mail or cron.';
COMMENT ON FUNCTION public.finish_zoho_order_confirmation(bigint,text,text) IS
 'Finalize single-attempt Zoho mail claim as accepted or blocked; no retry if uncertain.';

-- Read-only, service-only explanation of why a real order can or cannot be
-- used for a confirmation E2E test. Does NOT stage, approve, claim or send mail.
CREATE OR REPLACE FUNCTION public.preview_zoho_order_confirmation_eligibility(p_order_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v record;
  q record;
  reason text;
  payment_ok boolean;
  buyer_ok boolean;
  fresh boolean;
  event_ok boolean;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN
    RETURN jsonb_build_object('orderFound',false,'eligible',false,'reason','INVALID_ORDER_ID');
  END IF;
  SELECT o.status AS order_status, o.payment_method, o.payment_verified_at,
         o.created_at AS order_created_at, o.fulfillment_status,
         o.customer_email, o.customer_name, o.display_order_id,
         u.email AS user_email, u.email_confirmed_at
    INTO v
    FROM public.orders o
    LEFT JOIN auth.users u ON u.id=o.user_id
   WHERE o.id=p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('orderFound',false,'eligible',false,'reason','ORDER_NOT_FOUND');
  END IF;
  SELECT ob.status,ob.attempt_count,ob.created_at,ob.sent_at,ob.provider_message_id
    INTO q FROM public.zoho_order_email_outbox ob
   WHERE ob.order_id=p_order_id AND ob.event_type='order_confirmed'
     AND ob.provider='zoho_mail'
   LIMIT 1;
  payment_ok := coalesce(
    (v.payment_method='prepaid' AND v.order_status='paid' AND v.payment_verified_at IS NOT NULL)
    OR (v.payment_method='cod' AND v.order_status IN ('cod_pending','cod_collected')),false);
  buyer_ok := coalesce(v.email_confirmed_at IS NOT NULL
    AND NULLIF(btrim(v.customer_email),'') IS NOT NULL
    AND lower(btrim(v.user_email))=lower(btrim(v.customer_email))
    AND NULLIF(btrim(v.customer_name),'') IS NOT NULL
    AND NULLIF(btrim(v.display_order_id),'') IS NOT NULL,false);
  fresh := coalesce(v.order_created_at BETWEEN now()-interval '24 hours'
    AND now()+interval '5 minutes',false);
  event_ok := coalesce(q.status IN ('pending_review','ready')
    AND q.attempt_count=0 AND q.sent_at IS NULL
    AND q.provider_message_id IS NULL
    AND q.created_at BETWEEN now()-interval '24 hours' AND now(),false);
  reason := CASE
    WHEN NOT fresh THEN 'ORDER_TOO_OLD_OR_FUTURE'
    WHEN v.fulfillment_status IS NULL OR v.fulfillment_status='cancelled'
       THEN 'CANCELLED_OR_INVALID_FULFILLMENT'
    WHEN NOT payment_ok THEN 'PAYMENT_NOT_VERIFIED_OR_COD_NOT_CONFIRMED'
    WHEN NOT buyer_ok THEN 'CUSTOMER_EMAIL_OR_ORDER_DETAILS_NOT_VERIFIED'
    WHEN q.status IS NULL THEN 'CONFIRMATION_EVENT_NOT_STAGED'
    WHEN NOT event_ok THEN 'EVENT_ALREADY_PROCESSED_OR_STALE'
    ELSE 'ELIGIBLE_FOR_CONTROLLED_TEST'
  END;
  RETURN jsonb_build_object(
    'orderFound',true,'eligible',reason='ELIGIBLE_FOR_CONTROLLED_TEST',
    'reason',reason,'paymentVerified',payment_ok,
    'buyerVerified',buyer_ok,'recentOrder',fresh,
    'eventStaged',q.status IS NOT NULL,'eventStatus',q.status,
    'attemptCount',coalesce(q.attempt_count,0)
  );
END $function$;
REVOKE ALL ON FUNCTION public.preview_zoho_order_confirmation_eligibility(bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_zoho_order_confirmation_eligibility(bigint)
  TO service_role;
COMMENT ON FUNCTION public.preview_zoho_order_confirmation_eligibility(bigint) IS
 'Read-only redacted eligibility for controlled Zoho order-confirmation testing; never sends or mutates data.';

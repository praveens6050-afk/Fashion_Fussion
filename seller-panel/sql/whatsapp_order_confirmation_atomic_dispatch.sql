-- WhatsApp customer confirmation: COD support + atomic at-most-once submission.
-- Review and apply only after code QA; this migration does not send messages.
-- Existing opt-in, recipient, and approved-template requirements remain mandatory.
CREATE OR REPLACE FUNCTION private.ff_whatsapp_e164(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path TO ''
AS $$
 SELECT CASE
 WHEN regexp_replace(p_phone,'[^0-9]','','g') ~ '^[6-9][0-9]{9}$'
   THEN '+91'||regexp_replace(p_phone,'[^0-9]','','g')
 WHEN regexp_replace(p_phone,'[^0-9]','','g') ~ '^91[6-9][0-9]{9}$'
   THEN '+'||regexp_replace(p_phone,'[^0-9]','','g')
 WHEN left(btrim(p_phone),1)='+' AND regexp_replace(p_phone,'[^0-9]','','g') ~ '^[1-9][0-9]{7,14}$'
   THEN '+'||regexp_replace(p_phone,'[^0-9]','','g')
 ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION private.ff_whatsapp_e164(text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.whatsapp_order_notification_outbox
  ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.stage_whatsapp_order_event(p_order_id bigint,p_event_type text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_order public.orders%rowtype;
  v_consent public.whatsapp_order_consents%rowtype;
  v_count integer;
BEGIN
  IF p_event_type NOT IN ('order_confirmed','shipped','out_for_delivery','delivered')
    OR p_order_id IS NULL OR p_order_id<=0 THEN RETURN false; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND OR v_order.user_id IS NULL OR v_order.fulfillment_status='cancelled'
     OR v_order.status IN ('created','creating','expired','cancelled','cod_cancelled',
       'payment_failed','refund_pending','refund_initiated','refund_failed','refunded')
  THEN RETURN false; END IF;
  SELECT * INTO v_consent FROM public.whatsapp_order_consents
    WHERE order_id=p_order_id AND user_id=v_order.user_id AND revoked_at IS NULL;
  IF NOT FOUND OR v_consent.phone_e164 IS DISTINCT FROM
    private.ff_whatsapp_e164(v_order.customer_phone)
  THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.whatsapp_contact_consents c
    WHERE c.phone_e164=v_consent.phone_e164 AND c.purpose='transactional'
      AND c.status='opted_in' AND c.consented_at IS NOT NULL AND c.revoked_at IS NULL)
  THEN RETURN false; END IF;
  IF p_event_type='order_confirmed' THEN
    IF NOT (
      (v_order.payment_method='prepaid' AND v_order.status='paid'
         AND v_order.payment_verified_at IS NOT NULL)
       OR (v_order.payment_method='cod' AND v_order.status IN ('cod_pending','cod_collected'))
      ) OR v_order.fulfillment_status<>'ordered'
      OR v_order.created_at < now()-interval '24 hours'
    THEN RETURN false; END IF;
  ELSE
    IF v_order.status NOT IN ('paid','cod_pending','cod_collected')
      OR v_order.fulfillment_status<>p_event_type
      OR v_order.fulfillment_updated_at<v_consent.consented_at
    THEN RETURN false; END IF;
    IF p_event_type='delivered' AND v_order.payment_method='cod'
      AND v_order.status<>'cod_collected'
    THEN RETURN false; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.order_shipments s
      WHERE s.order_id=p_order_id AND s.direction='forward'
        AND nullif(btrim(s.awb_code),'') IS NOT NULL)
    THEN RETURN false; END IF;
  END IF;
  INSERT INTO public.whatsapp_order_notification_outbox
    (order_id,event_type,status,template_name)
  VALUES(p_order_id,p_event_type,'pending_review','order_status_update')
  ON CONFLICT(order_id,event_type) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count>0;
END;
$$;
REVOKE ALL ON FUNCTION public.stage_whatsapp_order_event(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage_whatsapp_order_event(bigint,text) TO service_role;

-- Only order-confirmed; validated CONSENT must match the exact order phone.
-- Database transaction serializes global quota checks and first attempts.
CREATE OR REPLACE FUNCTION public.claim_whatsapp_order_confirmation(p_order_id bigint,p_activation_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_claim record;
BEGIN
  IF p_order_id IS NULL OR p_order_id<=0 OR p_activation_cutoff IS NULL
     OR p_activation_cutoff>now() OR p_activation_cutoff<'2026-10-01'::timestamptz
  THEN RETURN NULL; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(733012,417021);
  IF (SELECT count(*) FROM public.whatsapp_order_notification_outbox
       WHERE attempt_started_at >= now()-interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.whatsapp_order_notification_outbox
       WHERE attempt_started_at >= now()-interval '24 hours') >= 20
  THEN RETURN NULL; END IF;
  UPDATE public.whatsapp_order_notification_outbox ob
  SET status='sending',attempt_count=1,attempt_started_at=now(),updated_at=now()
  FROM public.orders ord
  JOIN public.whatsapp_order_consents oc
    ON oc.order_id=ord.id AND oc.user_id=ord.user_id
  JOIN public.whatsapp_contact_consents cc
    ON cc.phone_e164=oc.phone_e164 AND cc.purpose='transactional'
  WHERE ob.order_id=ord.id AND ord.id=p_order_id
    AND ob.event_type='order_confirmed'
    AND ob.template_name='order_status_update'
    AND ob.status IN ('pending_review','ready') AND ob.attempt_count=0
    AND ob.provider_message_id IS NULL AND ob.attempt_started_at IS NULL
    AND ob.created_at BETWEEN greatest(p_activation_cutoff,now()-interval '24 hours') AND now()
    AND ord.created_at BETWEEN greatest(p_activation_cutoff,now()-interval '24 hours') AND now()
    AND ord.user_id IS NOT NULL AND ord.fulfillment_status='ordered'
    AND ( (ord.payment_method='prepaid' AND ord.status='paid' AND ord.payment_verified_at IS NOT NULL)
       OR (ord.payment_method='cod' AND ord.status IN ('cod_pending','cod_collected')) )
    AND nullif(btrim(ord.customer_name),'') IS NOT NULL
    AND nullif(btrim(ord.display_order_id),'') IS NOT NULL
    AND oc.revoked_at IS NULL AND oc.consented_at IS NOT NULL
    AND oc.phone_e164=private.ff_whatsapp_e164(ord.customer_phone)
    AND cc.status='opted_in' AND cc.consented_at IS NOT NULL AND cc.revoked_at IS NULL
  RETURNING ob.id,ord.customer_name,ord.display_order_id,oc.phone_e164
    INTO v_claim;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'outboxId',v_claim.id,'recipientPhone',v_claim.phone_e164,
    'customerName',v_claim.customer_name,'displayOrderId',v_claim.display_order_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_whatsapp_order_confirmation(bigint,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_order_confirmation(bigint,timestamptz) TO service_role;

-- Provider acknowledgement: no requeue, even after HTTP failure or timeout.
-- The signed Meta delivery webhook performs eventual delivery/read accounting.
CREATE OR REPLACE FUNCTION public.finish_whatsapp_order_confirmation(
  p_outbox_id bigint,p_provider_message_id text,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_changed integer;
BEGIN
  IF p_outbox_id IS NULL OR p_outbox_id<=0
     OR length(coalesce(p_error_code,''))>64
     OR (p_provider_message_id IS NOT NULL AND (
       length(p_provider_message_id)>255 OR
       p_provider_message_id !~ '^wamid[.][^[:space:]]+$'))
  THEN RETURN false; END IF;
  UPDATE public.whatsapp_order_notification_outbox
  SET status=CASE WHEN p_provider_message_id IS NOT NULL THEN 'accepted'
                  WHEN p_error_code='PROVIDER_OUTCOME_UNKNOWN' THEN 'blocked'
                  ELSE 'failed' END,
      provider_message_id=p_provider_message_id,
      last_error_code=p_error_code,
      updated_at=now()
  WHERE id=p_outbox_id AND status='sending' AND attempt_count=1
    AND provider_message_id IS NULL
  ;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_whatsapp_order_confirmation(bigint,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_whatsapp_order_confirmation(bigint,text,text) TO service_role;

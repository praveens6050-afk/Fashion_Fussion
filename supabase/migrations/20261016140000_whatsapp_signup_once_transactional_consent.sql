-- Signup-once, explicit transactional WhatsApp consent.
-- Depends on whatsapp_order_confirmation_atomic_dispatch.sql in PR #308.
-- Migration does not send messages, backfill orders, or turn on WhatsApp sending.
-- Anonymous/authenticated callers cannot invoke the privileged signup finalize RPC.

ALTER TABLE public.whatsapp_order_consents
  DROP CONSTRAINT IF EXISTS whatsapp_order_consents_source_check;
ALTER TABLE public.whatsapp_order_consents
  ADD CONSTRAINT whatsapp_order_consents_source_check
  CHECK(source IN ('checkout_checkbox','signup_verified_otp'));

-- Event ordering fields are required for idempotent STOP/START replay protection.
ALTER TABLE public.whatsapp_contact_consents
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_id text;

-- Complete verified OTP, attach profile phone, optionally store signed-up user
-- consent, and consume OTP IN ONE DATABASE TRANSACTION.
CREATE OR REPLACE FUNCTION public.finalize_whatsapp_signup_order_updates(
  p_user_id uuid,p_challenge_id uuid,p_audience text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user auth.users%rowtype;
  v_challenge public.phone_otp_challenges%rowtype;
  v_opt_in boolean;
  v_ledger_added boolean := false;
  v_time timestamptz := now();
  v_rows integer;
BEGIN
  IF p_user_id IS NULL OR p_challenge_id IS NULL
     OR p_audience NOT IN ('customer','retailer')
  THEN RAISE EXCEPTION 'Invalid account verification request' USING errcode='22023'; END IF;

  SELECT * INTO v_user FROM auth.users WHERE id=p_user_id;
  IF NOT FOUND OR
    v_user.raw_user_meta_data->>'whatsapp_signup_challenge_id' IS DISTINCT FROM p_challenge_id::text
    OR v_user.raw_user_meta_data->>'account_type' IS DISTINCT FROM p_audience
  THEN RAISE EXCEPTION 'Signup verification does not match this account' USING errcode='42501'; END IF;

  SELECT * INTO v_challenge FROM public.phone_otp_challenges
    WHERE id=p_challenge_id AND audience=p_audience
      AND lower(email)=lower(v_user.email)
    FOR UPDATE;
  IF NOT FOUND OR v_challenge.consumed_at IS NOT NULL
     OR v_challenge.verified_at IS NULL
     OR v_challenge.verified_at > v_time
     OR v_challenge.verified_at < v_time-interval '24 hours'
  THEN RAISE EXCEPTION 'A recent unused verified WhatsApp code is required' USING errcode='22023'; END IF;

  UPDATE public.profiles SET
    phone=CASE WHEN left(v_challenge.phone_e164,3)='+91'
      THEN substr(v_challenge.phone_e164,4) ELSE v_challenge.phone_e164 END,
    phone_verified_at=v_time,
    phone_verification_method='whatsapp',
    updated_at=v_time
  WHERE id=p_user_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Customer profile missing; WhatsApp verification not finalized'
      USING errcode='22023';
  END IF;

  -- A verified OTP is identity proof, not order-updates consent.
  -- Only an unchecked-by-default affirmative signup checkbox qualifies.
  v_opt_in := (v_user.raw_user_meta_data->>'whatsapp_order_updates_opt_in')='true'
    AND v_user.raw_user_meta_data->>'whatsapp_order_updates_consent_version'
      = 'signup_order_updates_v1';

  IF v_opt_in THEN
    INSERT INTO public.whatsapp_contact_consents AS ledger
      (phone_e164,purpose,status,source,proof_reference,consented_at,revoked_at,updated_at)
    VALUES
      (v_challenge.phone_e164,'transactional','opted_in','signup_verified_otp',
       'signup:'||p_user_id::text||':'||p_challenge_id::text,
       v_time,null,v_time)
    ON CONFLICT(phone_e164,purpose) DO UPDATE SET
      -- Never turn a previous STOP back ON from signup alone.
      status=ledger.status,
      source=excluded.source,
      proof_reference=excluded.proof_reference,
      consented_at=CASE WHEN ledger.status='opted_in' THEN v_time
                         ELSE ledger.consented_at END,
      revoked_at=ledger.revoked_at,
      updated_at=v_time,
      last_event_at=greatest(coalesce(ledger.last_event_at,'-infinity'::timestamptz),v_time)
    WHERE ledger.status IN ('opted_in','opted_out');
    -- An earlier STOP remains OFF. Linking this verified OTP allows a
    -- future, newer explicit START FASHION UPDATES to restore the opt-in.
    SELECT EXISTS(
      SELECT 1 FROM public.whatsapp_contact_consents cc
       WHERE cc.phone_e164=v_challenge.phone_e164 AND cc.purpose='transactional'
        AND cc.status='opted_in' AND cc.revoked_at IS NULL
        AND cc.source='signup_verified_otp'
        AND cc.proof_reference='signup:'||p_user_id::text||':'||p_challenge_id::text
    ) INTO v_ledger_added;
  END IF;

  UPDATE public.phone_otp_challenges
    SET consumed_at=v_time WHERE id=p_challenge_id AND consumed_at IS NULL;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Verification already finalized' USING errcode='22023';
  END IF;

  RETURN pg_catalog.jsonb_build_object('ok',true,'verified',true,
    'phone_hint','••••'||right(v_challenge.phone_e164,4),
    'transactional_consent_active',v_ledger_added);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_signup_order_updates(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_signup_order_updates(uuid,uuid,text)
  TO service_role;

-- Each fresh order automatically inherits signup-consent ONLY when
-- the same authenticated buyer verified the exact order phone.
-- No old-order backfill; explicitly opted-out customers never qualify.
CREATE OR REPLACE FUNCTION public.ff_attach_signup_whatsapp_to_new_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.created_at IS NULL
     OR NEW.created_at < now()-interval '24 hours' THEN RETURN NEW; END IF;

  INSERT INTO public.whatsapp_order_consents
    (order_id,user_id,phone_e164,source,consented_at,revoked_at)
  SELECT NEW.id,NEW.user_id,cc.phone_e164,'signup_verified_otp',cc.consented_at,null
  FROM public.whatsapp_contact_consents cc
  JOIN auth.users u ON u.id=NEW.user_id
  JOIN public.phone_otp_challenges otp
    ON cc.proof_reference='signup:'||NEW.user_id::text||':'||otp.id::text
   AND otp.phone_e164=cc.phone_e164
   AND lower(otp.email)=lower(u.email)
   AND otp.audience=u.raw_user_meta_data->>'account_type'
   AND otp.verified_at IS NOT NULL
   AND otp.consumed_at IS NOT NULL
   AND otp.consumed_at>=otp.verified_at
   AND otp.consumed_at<=NEW.created_at
  CROSS JOIN LATERAL (
    SELECT regexp_replace(coalesce(NEW.customer_phone,''),'[^0-9]','','g') AS digits
  ) normalized_phone
  WHERE cc.phone_e164=CASE
      WHEN normalized_phone.digits ~ '^[6-9][0-9]{9}$'
        THEN '+91'||normalized_phone.digits
      WHEN normalized_phone.digits ~ '^91[6-9][0-9]{9}$'
        THEN '+'||normalized_phone.digits
      WHEN left(btrim(coalesce(NEW.customer_phone,'')),1)='+'
        AND normalized_phone.digits ~ '^[1-9][0-9]{7,14}$'
        THEN '+'||normalized_phone.digits
      ELSE NULL
    END
    AND cc.purpose='transactional'
    AND cc.status='opted_in'
    AND cc.revoked_at IS NULL
    AND cc.consented_at IS NOT NULL
    AND cc.consented_at<=NEW.created_at
    AND cc.source='signup_verified_otp'
  ON CONFLICT(order_id) DO NOTHING;

  -- Verified OTP challenge is authoritative; client-writable profile flags are not.
  -- Existing AFTER INSERT ON whatsapp_order_consents stages a fresh COD event.
  -- Prepaid remains pending until the verified payment transition trigger.
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ff_attach_signup_whatsapp_to_new_order ON public.orders;
CREATE TRIGGER trg_ff_attach_signup_whatsapp_to_new_order
 AFTER INSERT ON public.orders FOR EACH ROW
 EXECUTE FUNCTION public.ff_attach_signup_whatsapp_to_new_order();

-- Signed Meta webhook controls transactional STOP and explicit restart.
-- Does not change marketing opt-in, and never creates a new signup proof.
CREATE OR REPLACE FUNCTION public.record_whatsapp_transactional_keyword(
 p_phone_e164 text,p_external_message_id text,p_status text,p_event_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_count integer;
BEGIN
  IF p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     OR p_external_message_id IS NULL OR
        length(p_external_message_id) NOT BETWEEN 5 AND 255
     OR p_status NOT IN ('opted_in','opted_out')
     OR p_event_at IS NULL OR p_event_at>now()+interval '5 minutes'
     OR p_event_at<'2020-01-01'::timestamptz
  THEN RAISE EXCEPTION 'Invalid signed transactional opt-out metadata' USING errcode='22023'; END IF;

  IF p_status='opted_in' THEN
    -- START from WhatsApp may reactivate a previous explicit signup consent,
    -- but cannot fabricate one for a number without owner-bound signup proof.
    UPDATE public.whatsapp_contact_consents c
    SET status='opted_in',consented_at=p_event_at,revoked_at=null,
        last_event_at=p_event_at,last_event_id=p_external_message_id,updated_at=now()
    WHERE c.phone_e164=p_phone_e164 AND c.purpose='transactional'
      AND c.source='signup_verified_otp' AND c.proof_reference LIKE 'signup:%'
      AND p_event_at > greatest(
        coalesce(c.last_event_at,'-infinity'::timestamptz),
        coalesce(c.consented_at,'-infinity'::timestamptz),
        coalesce(c.revoked_at,'-infinity'::timestamptz));
  ELSE
    INSERT INTO public.whatsapp_contact_consents AS c
      (phone_e164,purpose,status,source,proof_reference,
       consented_at,revoked_at,updated_at,last_event_at,last_event_id)
    VALUES(p_phone_e164,'transactional','opted_out',
      'whatsapp_keyword_transactional',p_external_message_id,
      null,p_event_at,now(),p_event_at,p_external_message_id)
    ON CONFLICT(phone_e164,purpose) DO UPDATE SET
      status='opted_out',revoked_at=p_event_at,updated_at=now(),
      last_event_at=p_event_at,last_event_id=p_external_message_id
    WHERE p_event_at > greatest(
      coalesce(c.last_event_at,'-infinity'::timestamptz),
      coalesce(c.consented_at,'-infinity'::timestamptz),
      coalesce(c.revoked_at,'-infinity'::timestamptz))
      OR (c.last_event_at=p_event_at AND c.status='opted_in');
    -- Existing signup source/proof_reference are intentionally preserved:
    -- STOP suppresses new orders and START can later restore the original.
  END IF;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count>0;
END;
$$;
REVOKE ALL ON FUNCTION public.record_whatsapp_transactional_keyword(text,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_transactional_keyword(text,text,text,timestamptz)
  TO service_role;

-- Full clean-replay validation must run against the PR #325 baseline branch before merge.

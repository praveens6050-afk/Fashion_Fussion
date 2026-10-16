-- Isolated GitHub Actions PostgreSQL assertions for signup consent.
-- All data is synthetic; transaction is rolled back.
BEGIN;
DO $signup$
DECLARE
  u1 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  c1 uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  u2 uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  c2 uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  result jsonb;
  profile_phone text;
  challenge_consumed timestamptz;
  ledger_status text;
  ledger_source text;
  order_consent_count integer;
  replay_rejected boolean := false;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (u1,'signup-consented@example.test',jsonb_build_object(
      'account_type','customer','whatsapp_signup_challenge_id',c1::text,
      'whatsapp_order_updates_opt_in',true,
      'whatsapp_order_updates_consent_version','signup_order_updates_v1')),
    (u2,'signup-no-consent@example.test',jsonb_build_object(
      'account_type','retailer','whatsapp_signup_challenge_id',c2::text));
  INSERT INTO public.profiles(id) VALUES(u1),(u2);
  INSERT INTO public.phone_otp_challenges(id,phone_e164,email,audience,verified_at) VALUES
    (c1,'+919876543210','signup-consented@example.test','customer',now()-interval '1 minute'),
    (c2,'+919876543211','signup-no-consent@example.test','retailer',now()-interval '1 minute');

  result := public.finalize_whatsapp_signup_order_updates(u1,c1,'customer');
  IF result->>'ok' <> 'true' OR result->>'verified' <> 'true'
     OR result->>'transactional_consent_active' <> 'true' THEN
    RAISE EXCEPTION 'Explicit signup consent was not atomically finalized: %',result;
  END IF;
  SELECT phone INTO profile_phone FROM public.profiles WHERE id=u1;
  SELECT consumed_at INTO challenge_consumed FROM public.phone_otp_challenges WHERE id=c1;
  SELECT status,source INTO ledger_status,ledger_source
    FROM public.whatsapp_contact_consents
    WHERE phone_e164='+919876543210' AND purpose='transactional';
  IF profile_phone <> '9876543210' OR challenge_consumed IS NULL
     OR ledger_status <> 'opted_in' OR ledger_source <> 'signup_verified_otp' THEN
    RAISE EXCEPTION 'Profile, OTP consumption or consent ledger not finalized atomically';
  END IF;

  result := public.finalize_whatsapp_signup_order_updates(u2,c2,'retailer');
  IF result->>'ok' <> 'true' OR result->>'transactional_consent_active' <> 'false'
     OR EXISTS(SELECT 1 FROM public.whatsapp_contact_consents
       WHERE phone_e164='+919876543211' AND purpose='transactional') THEN
    RAISE EXCEPTION 'OTP verification was incorrectly treated as consent';
  END IF;

  BEGIN
    PERFORM public.finalize_whatsapp_signup_order_updates(u1,c1,'customer');
  EXCEPTION WHEN OTHERS THEN
    replay_rejected := true;
  END;
  IF NOT replay_rejected THEN
    RAISE EXCEPTION 'A consumed signup OTP was allowed to finalize twice';
  END IF;

  INSERT INTO public.orders(id,user_id,status,fulfillment_status,payment_method,
    customer_phone,customer_name,display_order_id,created_at)
  VALUES(91001,u1,'cod_pending','ordered','cod','9876543210','Synthetic Buyer',
    'FF-CI-91001',now());
  SELECT count(*) INTO order_consent_count FROM public.whatsapp_order_consents
    WHERE order_id=91001 AND user_id=u1 AND source='signup_verified_otp'
      AND phone_e164='+919876543210' AND revoked_at IS NULL;
  IF order_consent_count <> 1 THEN
    RAISE EXCEPTION 'Verified signup consent did not attach to the matching new order';
  END IF;
END;
$signup$;
ROLLBACK;

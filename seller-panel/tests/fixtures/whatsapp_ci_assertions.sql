-- Run only on ephemeral PostgreSQL CI service, after both migrations.
\set ON_ERROR_STOP on
-- A: explicit customer opt-in and verified, consumed OTP.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('11111111-1111-4111-8111-111111111111','buyer-a@example.invalid',
  '{"account_type":"customer","whatsapp_signup_challenge_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","whatsapp_order_updates_opt_in":true,"whatsapp_order_updates_consent_version":"signup_order_updates_v1"}'),
 ('22222222-2222-4222-8222-222222222222','buyer-b@example.invalid',
  '{"account_type":"customer","whatsapp_signup_challenge_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}'),
 ('33333333-3333-4333-8333-333333333333','buyer-c@example.invalid',
  '{"account_type":"customer","whatsapp_signup_challenge_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","whatsapp_order_updates_opt_in":true,"whatsapp_order_updates_consent_version":"signup_order_updates_v1"}');
INSERT INTO public.profiles(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.phone_otp_challenges(id,email,phone_e164,audience,verified_at)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','buyer-a@example.invalid','+919876543210','customer',now()-interval '2 minutes'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','buyer-b@example.invalid','+919876543211','customer',now()-interval '2 minutes'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','buyer-c@example.invalid','+919876543212','customer',now()-interval '2 minutes');
DO $$
DECLARE r jsonb;
BEGIN
  r:=public.finalize_whatsapp_signup_order_updates(
    '11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','customer');
  IF r->>'transactional_consent_active'<>'true' THEN RAISE EXCEPTION 'Buyer A opt-in was not recorded'; END IF;
  r:=public.finalize_whatsapp_signup_order_updates(
    '22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','customer');
  IF r->>'transactional_consent_active'<>'false' THEN RAISE EXCEPTION 'Buyer B OTP incorrectly inferred consent'; END IF;
  IF (SELECT COUNT(*) FROM public.whatsapp_contact_consents WHERE purpose='transactional')<>1
  THEN RAISE EXCEPTION 'Unexpected consent count after A opt-in and B no opt-in'; END IF;
END;
$$;
-- At-most-once verified challenge consumption: second call must fail.
DO $$
BEGIN
  PERFORM public.finalize_whatsapp_signup_order_updates(
    '11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','customer');
  RAISE EXCEPTION 'Duplicate OTP finalize unexpectedly succeeded';
EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
END;
$$;
-- Fake OTP owner must not gain another phone or consent.
DO $$
BEGIN
  PERFORM public.finalize_whatsapp_signup_order_updates(
    '22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','customer');
  RAISE EXCEPTION 'Cross-user OTP unexpectedly succeeded';
EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
END;
$$;

-- COD: same user, same verified phone, consent automatically attached and staged.
INSERT INTO public.orders(id,user_id,customer_phone,customer_name,display_order_id,payment_method,status,fulfillment_status)
VALUES
 (101,'11111111-1111-4111-8111-111111111111','9876543210','Buyer A','FF-COD-101','cod','cod_pending','ordered'),
 (102,'22222222-2222-4222-8222-222222222222','9876543211','Buyer B','FF-COD-102','cod','cod_pending','ordered'),
 (103,'22222222-2222-4222-8222-222222222222','9876543210','Buyer B','FF-COD-103','cod','cod_pending','ordered'),
 (104,'11111111-1111-4111-8111-111111111111','9999999999','Buyer A','FF-COD-104','cod','cod_pending','ordered');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.whatsapp_order_consents)<>1
   OR (SELECT count(*) FROM public.whatsapp_order_notification_outbox)<>1
   OR NOT EXISTS(SELECT 1 FROM public.whatsapp_order_notification_outbox WHERE order_id=101 AND event_type='order_confirmed')
 THEN RAISE EXCEPTION 'COD auto-attach/staging or no-consent rejection failed'; END IF;
 IF public.stage_whatsapp_order_event(101,'order_confirmed') THEN
   RAISE EXCEPTION 'Duplicate COD event unexpectedly staged'; END IF;
END;
$$;

-- Prepaid: creation and unverified paid state cannot stage.
INSERT INTO public.orders(id,user_id,customer_phone,customer_name,display_order_id,payment_method,status,fulfillment_status)
VALUES(105,'11111111-1111-4111-8111-111111111111','+919876543210','Buyer A','FF-ONLINE-105','prepaid','created','ordered');
UPDATE public.orders SET status='paid' WHERE id=105;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.whatsapp_order_notification_outbox WHERE order_id=105)
 THEN RAISE EXCEPTION 'Prepaid sent before verified payment'; END IF;
END $$;
UPDATE public.orders SET payment_verified_at=now() WHERE id=105;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_order_notification_outbox WHERE order_id=105 AND event_type='order_confirmed')
 THEN RAISE EXCEPTION 'Verified prepaid event was not staged'; END IF;
END $$;

-- STOP: suppress new events and cancel eligibility of existing unsent outbox.
SELECT public.record_whatsapp_transactional_keyword(
 '+919876543210','wamid.TEST_STOP_001','opted_out',clock_timestamp());
INSERT INTO public.orders(id,user_id,customer_phone,customer_name,display_order_id,payment_method,status,fulfillment_status)
VALUES(106,'11111111-1111-4111-8111-111111111111','9876543210','Buyer A','FF-COD-106','cod','cod_pending','ordered');
DO $$
DECLARE claim jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.whatsapp_order_consents WHERE order_id=106)
 THEN RAISE EXCEPTION 'Order consent inherited after STOP'; END IF;
 claim:=public.claim_whatsapp_order_confirmation(101,now()-interval '10 minutes');
 IF claim IS NOT NULL THEN RAISE EXCEPTION 'STOP did not block old unattempted notification'; END IF;
END;
$$;
-- Old signed messages must not override newer consent.
SELECT public.record_whatsapp_transactional_keyword(
 '+919876543210','wamid.TEST_OLD_START','opted_in',clock_timestamp()-interval '1 minute');
DO $$ BEGIN
 IF (SELECT status FROM public.whatsapp_contact_consents
     WHERE phone_e164='+919876543210' AND purpose='transactional')<>'opted_out'
 THEN RAISE EXCEPTION 'Stale START re-enabled after STOP'; END IF;
END $$;
SELECT pg_sleep(0.02);
SELECT public.record_whatsapp_transactional_keyword(
 '+919876543210','wamid.TEST_START_001','opted_in',clock_timestamp());
SELECT pg_sleep(0.02);
INSERT INTO public.orders(id,user_id,customer_phone,customer_name,display_order_id,payment_method,status,fulfillment_status)
VALUES(107,'11111111-1111-4111-8111-111111111111','9876543210','Buyer A','FF-COD-107','cod','cod_pending','ordered');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_order_notification_outbox WHERE order_id=107)
 THEN RAISE EXCEPTION 'Explicit START did not restore future opted-in orders'; END IF;
END $$;
SELECT public.record_whatsapp_transactional_keyword(
 '+919876543210','wamid.TEST_OLD_STOP','opted_out',clock_timestamp()-interval '2 minutes');
DO $$ BEGIN
 IF (SELECT status FROM public.whatsapp_contact_consents
     WHERE phone_e164='+919876543210' AND purpose='transactional')<>'opted_in'
 THEN RAISE EXCEPTION 'Stale STOP overrode newer START'; END IF;
END $$;

-- STOP before signup: later verified signup may attach proof but cannot reactivate.
SELECT public.record_whatsapp_transactional_keyword(
 '+919876543212','wamid.TEST_C_STOP','opted_out',clock_timestamp());
SELECT pg_sleep(0.02);
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.finalize_whatsapp_signup_order_updates(
  '33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','customer');
 IF r->>'transactional_consent_active'<>'false'
 THEN RAISE EXCEPTION 'Prior STOP overridden during signup'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_contact_consents
   WHERE phone_e164='+919876543212' AND purpose='transactional'
     AND source='signup_verified_otp' AND status='opted_out')
 THEN RAISE EXCEPTION 'Signup did not preserve STOP with proof for explicit START'; END IF;
END $$;
SELECT pg_sleep(0.02);
SELECT public.record_whatsapp_transactional_keyword(
 '+919876543212','wamid.TEST_C_START','opted_in',clock_timestamp());
SELECT pg_sleep(0.02);
INSERT INTO public.orders(id,user_id,customer_phone,customer_name,display_order_id,payment_method,status,fulfillment_status)
VALUES(108,'33333333-3333-4333-8333-333333333333','9876543212','Buyer C','FF-COD-108','cod','cod_pending','ordered');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_order_notification_outbox WHERE order_id=108)
 THEN RAISE EXCEPTION 'Explicit opt-in from previous STOP failed on new order'; END IF;
END $$;

-- One claim, no duplicate send; rate bound; provider finalization.
DO $$
DECLARE r jsonb; r2 jsonb;
BEGIN
 r:=public.claim_whatsapp_order_confirmation(101,now()-interval '10 minutes');
 IF r IS NULL OR r->>'displayOrderId'<>'FF-COD-101'
 THEN RAISE EXCEPTION 'Eligible COD first claim failed'; END IF;
 r2:=public.claim_whatsapp_order_confirmation(101,now()-interval '10 minutes');
 IF r2 IS NOT NULL THEN RAISE EXCEPTION 'Duplicate atomic claim succeeded'; END IF;
 IF NOT public.finish_whatsapp_order_confirmation((r->>'outboxId')::bigint,'wamid.TEST_ACK_001')
 THEN RAISE EXCEPTION 'Provider ack not persisted'; END IF;
 IF public.finish_whatsapp_order_confirmation((r->>'outboxId')::bigint,'wamid.TEST_ACK_002')
 THEN RAISE EXCEPTION 'Second finalization unexpectedly succeeded'; END IF;
END;
$$;
SELECT 'PASS - WhatsApp signup-once SQL integration, consent, STOP and idempotency' AS result;

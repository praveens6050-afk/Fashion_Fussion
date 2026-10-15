-- Tests against ephemeral CI Postgres only; fixture data is synthetic.
-- pg_catalog and table assertions run in a transaction that is rolled back.
BEGIN;
DO $test$
DECLARE
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  common_phone text := '+919876543210';
  consent_time timestamptz := now()-interval '2 hours';
  cutoff_time timestamptz := now()-interval '1 hour';
  claimed jsonb;
  n integer;
  id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_order_notification_outbox'
      AND column_name='attempt_started_at'
  ) THEN
    RAISE EXCEPTION 'Atomic attempt timestamp column not installed';
  END IF;

  INSERT INTO public.whatsapp_contact_consents(phone_e164,purpose,status,consented_at)
    VALUES(common_phone,'transactional','opted_in',consent_time);
  INSERT INTO public.whatsapp_contact_consents(phone_e164,purpose,status,consented_at,revoked_at)
    VALUES('+919123456780','transactional','opted_out',consent_time,now()-interval '1 hour');

  FOR id IN 1..14 LOOP
    INSERT INTO public.orders
      (id,user_id,status,payment_method,payment_verified_at,fulfillment_status,
       fulfillment_updated_at,created_at,customer_phone,customer_name,display_order_id)
    VALUES(
      id,owner_id,
      CASE WHEN id IN (2,3) THEN 'paid'
           WHEN id=5 THEN 'cod_cancelled'
           WHEN id=14 THEN 'cod_collected'
           ELSE 'cod_pending' END,
      CASE WHEN id IN (2,3) THEN 'prepaid' ELSE 'cod' END,
      CASE WHEN id=3 THEN now()-interval '5 minutes' ELSE NULL END,
      CASE WHEN id IN (10,11,12) THEN 'shipped'
           WHEN id IN (13,14) THEN 'delivered'
           WHEN id=5 THEN 'cancelled'
           ELSE 'ordered' END,
      CASE WHEN id=11 THEN consent_time-interval '1 minute'
           ELSE now()-interval '1 minute' END,
      CASE WHEN id=9 THEN now()-interval '50 hours' ELSE now()-interval '5 minutes' END,
      CASE WHEN id=6 THEN '+919765432100'
           WHEN id=7 THEN '+919333333330'
           WHEN id=8 THEN '+919123456780'
           ELSE common_phone END,
      'Synthetic Test Buyer','TEST-'||id::text
    );
    IF id<>1 AND id<>7 THEN
      INSERT INTO public.whatsapp_order_consents
        (order_id,user_id,phone_e164,consented_at)
      VALUES(id,owner_id,
        CASE WHEN id=7 THEN '+919333333330' ELSE common_phone END,
        consent_time);
    END IF;
  END LOOP;

  -- Override to test wrong phone and inactive contact, without touching users.
  UPDATE public.whatsapp_order_consents SET phone_e164=common_phone WHERE order_id=6;
  UPDATE public.whatsapp_order_consents SET phone_e164='+919333333330' WHERE order_id=7;
  UPDATE public.whatsapp_order_consents SET phone_e164='+919123456780' WHERE order_id=8;
  INSERT INTO public.order_shipments(order_id,direction,awb_code)
    VALUES(10,'forward','TEST-SHIP-10'),(11,'forward','TEST-SHIP-11'),
          (12,'return','TEST-RETURN-12'),(13,'forward','TEST-DELIV-13'),
          (14,'forward','TEST-DELIV-14');

  IF public.stage_whatsapp_order_event(1,'order_confirmed') THEN
    RAISE EXCEPTION 'No per-order consent was accepted';
  END IF;
  IF public.stage_whatsapp_order_event(2,'order_confirmed') THEN
    RAISE EXCEPTION 'Unverified prepaid order was staged';
  END IF;
  IF NOT public.stage_whatsapp_order_event(3,'order_confirmed') THEN
    RAISE EXCEPTION 'Verified prepaid did not stage';
  END IF;
  IF public.stage_whatsapp_order_event(3,'order_confirmed') THEN
    RAISE EXCEPTION 'Duplicate prepaid event was staged';
  END IF;
  IF NOT public.stage_whatsapp_order_event(4,'order_confirmed') THEN
    RAISE EXCEPTION 'Confirmed COD did not stage';
  END IF;
  IF public.stage_whatsapp_order_event(4,'order_confirmed') THEN
    RAISE EXCEPTION 'Duplicate COD event staged';
  END IF;
  FOR id IN 5..9 LOOP
    IF public.stage_whatsapp_order_event(id,'order_confirmed') THEN
      RAISE EXCEPTION 'Ineligible order % was staged',id;
    END IF;
  END LOOP;
  IF NOT public.stage_whatsapp_order_event(10,'shipped') THEN
    RAISE EXCEPTION 'Verified shipping event did not stage';
  END IF;
  IF public.stage_whatsapp_order_event(11,'shipped')
    OR public.stage_whatsapp_order_event(12,'shipped') THEN
    RAISE EXCEPTION 'Shipment staged without AWB or prior to consent';
  END IF;
  IF public.stage_whatsapp_order_event(13,'delivered') THEN
    RAISE EXCEPTION 'COD delivery without collection was staged';
  END IF;
  IF NOT public.stage_whatsapp_order_event(14,'delivered') THEN
    RAISE EXCEPTION 'Confirmed COD delivery did not stage';
  END IF;
  IF (SELECT count(*) FROM public.whatsapp_order_notification_outbox)<>4 THEN
    RAISE EXCEPTION 'Unexpected staged event count';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_order_notification_outbox WHERE attempt_count<>0 OR status<>'pending_review') THEN
    RAISE EXCEPTION 'Staging unexpectedly initiated sending';
  END IF;
  IF public.claim_whatsapp_order_confirmation(1,cutoff_time) IS NOT NULL THEN
    RAISE EXCEPTION 'Order without consent was claimed';
  END IF;
  IF public.claim_whatsapp_order_confirmation(3,now()+interval '1 hour') IS NOT NULL THEN
    RAISE EXCEPTION 'Future activation cutoff accepted';
  END IF;

  -- Atomic first claim for a real verified COD; second call MUST be no-op.
  claimed := public.claim_whatsapp_order_confirmation(4,cutoff_time);
  IF claimed IS NULL OR claimed->>'recipientPhone' <> common_phone
       OR claimed->>'displayOrderId' <> 'TEST-4' THEN
    RAISE EXCEPTION 'COD atomic claim failed to return expected verified data';
  END IF;
  IF public.claim_whatsapp_order_confirmation(4,cutoff_time) IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate order confirmation claim permitted';
  END IF;
  IF NOT public.finish_whatsapp_order_confirmation((claimed->>'outboxId')::bigint,'wamid.synthetic-first',NULL) THEN
    RAISE EXCEPTION 'Provider acknowledgement was not saved';
  END IF;
  IF public.finish_whatsapp_order_confirmation((claimed->>'outboxId')::bigint,'wamid.synthetic-duplicate',NULL) THEN
    RAISE EXCEPTION 'Provider status was overwritten by duplicate finish';
  END IF;
  IF (SELECT status FROM public.whatsapp_order_notification_outbox WHERE order_id=4)<>'accepted' THEN
    RAISE EXCEPTION 'Accepted status missing';
  END IF;

  -- Separate synthetic COD orders exceed the rolling 5/hour global cap.
  FOR id IN 100..104 LOOP
    INSERT INTO public.orders(id,user_id,status,payment_method,fulfillment_status,
      created_at,customer_phone,customer_name,display_order_id)
    VALUES(id,owner_id,'cod_pending','cod','ordered',now(),common_phone,'Synthetic Buyer','QUOTA-'||id);
    INSERT INTO public.whatsapp_order_consents(order_id,user_id,phone_e164,consented_at)
    VALUES(id,owner_id,common_phone,consent_time);
    IF NOT public.stage_whatsapp_order_event(id,'order_confirmed') THEN
      RAISE EXCEPTION 'Quota fixture failed to stage %',id;
    END IF;
  END LOOP;
  FOR id IN 100..103 LOOP
    claimed:=public.claim_whatsapp_order_confirmation(id,cutoff_time);
    IF claimed IS NULL THEN
      RAISE EXCEPTION 'Claim % unexpectedly failed before quota limit',id;
    END IF;
  END LOOP;
  IF public.claim_whatsapp_order_confirmation(104,cutoff_time) IS NOT NULL THEN
    RAISE EXCEPTION 'Hourly quota exceeded 5 claims';
  END IF;
  SELECT count(*) INTO n FROM public.whatsapp_order_notification_outbox
    WHERE attempt_started_at >= now()-interval '1 hour';
  IF n<>5 THEN
    RAISE EXCEPTION 'Expected exactly five first attempts; got %',n;
  END IF;
  IF pg_catalog.has_function_privilege('anon','public.claim_whatsapp_order_confirmation(bigint,timestamptz)','EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated','public.claim_whatsapp_order_confirmation(bigint,timestamptz)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.claim_whatsapp_order_confirmation(bigint,timestamptz)','EXECUTE')
  THEN RAISE EXCEPTION 'Atomic claim RPC execute grants are unsafe'; END IF;
  IF pg_catalog.has_function_privilege('anon','public.finish_whatsapp_order_confirmation(bigint,text,text)','EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated','public.finish_whatsapp_order_confirmation(bigint,text,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.finish_whatsapp_order_confirmation(bigint,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Finish RPC execute grants are unsafe'; END IF;

  -- SECURITY DEFINER checkout consent must be reachable by authenticated
  -- customers only, not by anonymous callers via default PUBLIC grants.
  IF pg_catalog.has_function_privilege('anon','public.record_checkout_whatsapp_consent(bigint)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.record_checkout_whatsapp_consent(bigint)','EXECUTE')
  THEN RAISE EXCEPTION 'Checkout opt-in RPC grants are unsafe'; END IF;
  IF pg_catalog.has_function_privilege('anon','public.stage_whatsapp_order_event(bigint,text)','EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated','public.stage_whatsapp_order_event(bigint,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Internal staging RPC leaked to browser roles'; END IF;

  -- Real checkout path: first-time consent must stage only a confirmed,
  -- authenticated synthetic order, without contacting Meta or sending.
  PERFORM pg_catalog.set_config('ff.test_uid',owner_id::text,true);
  IF NOT (public.record_checkout_whatsapp_consent(1)->>'ok')::boolean THEN
    RAISE EXCEPTION 'Valid checkout consent failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_order_notification_outbox
     WHERE order_id=1 AND event_type='order_confirmed' AND attempt_count=0) THEN
    RAISE EXCEPTION 'First checkout consent did not stage a pending review';
  END IF;
  IF public.stage_whatsapp_order_event(1,'order_confirmed') THEN
    RAISE EXCEPTION 'Opt-in produced duplicate staged order event';
  END IF;
  RAISE NOTICE 'PASS: consent, COD/prepaid, shipment, cancelled, historical, atomic claim, idempotency, hourly cap, checkout path and grants';
END
$test$;
ROLLBACK;

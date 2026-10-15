-- Isolated GitHub Actions PostgreSQL fixture only. Never use production.
-- Runs after original migration contract, on synthetic records and rolls back.
BEGIN;
DO $shipping$
DECLARE
  owner_id uuid:='11111111-1111-4111-8111-111111111111';
  phone text:='+919876543210';
  consent_time timestamptz:=now()-interval '10 minutes';
  event_time timestamptz:=now()-interval '3 minutes';
  cutoff_time timestamptz:=now()-interval '1 hour';
  eid bigint;
  ev text;
  expected_label text;
  claimed jsonb;
  i integer;
BEGIN
  INSERT INTO public.whatsapp_contact_consents(phone_e164,purpose,status,consented_at)
  VALUES(phone,'transactional','opted_in',consent_time);

  -- 500-504 are valid shipping events, with the same verified customer and
  -- distinct outbox keys. 510 is an ordinary COD confirmation sharing quota.
  FOR eid IN 500..504 LOOP
    ev:=CASE eid WHEN 500 THEN 'shipped'
                 WHEN 501 THEN 'out_for_delivery'
                 WHEN 502 THEN 'delivered'
                 ELSE 'shipped' END;
    INSERT INTO public.orders(id,user_id,status,payment_method,fulfillment_status,
      payment_verified_at,customer_phone,customer_name,display_order_id,
      created_at,fulfillment_updated_at)
    VALUES(eid,owner_id,
      CASE WHEN eid=502 THEN 'cod_collected'
           WHEN eid=501 THEN 'paid' ELSE 'cod_pending' END,
      CASE WHEN eid=501 THEN 'prepaid' ELSE 'cod' END,
      ev,CASE WHEN eid=501 THEN now()-interval '4 minutes' ELSE null END,
      phone,'Synthetic Shipping Buyer','SHIP-'||eid::text,
      now()-interval '20 minutes',event_time);
    INSERT INTO public.whatsapp_order_consents(order_id,user_id,phone_e164,consented_at)
      VALUES(eid,owner_id,phone,consent_time);
    INSERT INTO public.order_shipments(order_id,direction,awb_code)
      VALUES(eid,'forward','SYNTHETIC-AWB-'||eid::text);
    IF NOT public.stage_whatsapp_order_event(eid,ev) THEN
      RAISE EXCEPTION 'Valid shipping event % did not stage',eid;
    END IF;
    IF public.stage_whatsapp_order_event(eid,ev) THEN
      RAISE EXCEPTION 'Duplicate shipping event % staged twice',eid;
    END IF;
  END LOOP;

  INSERT INTO public.orders(id,user_id,status,payment_method,fulfillment_status,
    customer_phone,customer_name,display_order_id,created_at)
  VALUES(510,owner_id,'cod_pending','cod','ordered',phone,
         'Synthetic Buyer','TEST-510',now()-interval '20 minutes');
  INSERT INTO public.whatsapp_order_consents(order_id,user_id,phone_e164,consented_at)
  VALUES(510,owner_id,phone,consent_time);
  IF NOT public.stage_whatsapp_order_event(510,'order_confirmed') THEN
    RAISE EXCEPTION 'Synthetic COD confirmation did not stage';
  END IF;

  IF public.claim_whatsapp_shipping_event(500,'invalid',cutoff_time) IS NOT NULL
    OR public.claim_whatsapp_shipping_event(500,'order_confirmed',cutoff_time) IS NOT NULL
    OR public.claim_whatsapp_shipping_event(500,'shipped',now()+interval '1 hour') IS NOT NULL
  THEN RAISE EXCEPTION 'Shipping function accepted invalid event/cutoff'; END IF;

  -- Invalid records are inserted into pending_review intentionally to prove
  -- the CLAIM function re-checks genuine payment, delivery, AWB and consent.
  FOR eid IN 520..526 LOOP
    ev:=CASE eid WHEN 520 THEN 'delivered' ELSE 'shipped' END;
    INSERT INTO public.orders(id,user_id,status,payment_method,fulfillment_status,
      payment_verified_at,customer_phone,customer_name,display_order_id,
      created_at,fulfillment_updated_at)
    VALUES(eid,owner_id,
      CASE WHEN eid=521 THEN 'paid' ELSE 'cod_pending' END,
      CASE WHEN eid=521 THEN 'prepaid' ELSE 'cod' END,
      ev,NULL,
      CASE WHEN eid=524 THEN '+919999999990' ELSE phone END,
      'Synthetic Invalid Buyer','BAD-'||eid::text,
      now()-interval '25 minutes',
      CASE WHEN eid=525 THEN now()-interval '36 hours'
           WHEN eid=526 THEN now()-interval '15 minutes'
           ELSE event_time END);
    INSERT INTO public.whatsapp_order_consents(order_id,user_id,phone_e164,consented_at,
      revoked_at) VALUES(eid,owner_id,phone,consent_time,
        CASE WHEN eid=523 THEN now()-interval '1 minute' ELSE NULL END);
    IF eid<>522 THEN
      INSERT INTO public.order_shipments(order_id,direction,awb_code)
      VALUES(eid,'forward','INVALID-AWB-'||eid::text);
    END IF;
    INSERT INTO public.whatsapp_order_notification_outbox(order_id,event_type,status)
      VALUES(eid,ev,'pending_review');
    IF public.claim_whatsapp_shipping_event(eid,ev,cutoff_time) IS NOT NULL THEN
      RAISE EXCEPTION 'Ineligible shipping event % was claimed',eid;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_order_notification_outbox
    WHERE order_id BETWEEN 520 AND 526 AND attempt_count>0
  ) THEN RAISE EXCEPTION 'Bad shipping event consumed provider attempt'; END IF;

  FOR eid IN 500..503 LOOP
    ev:=CASE eid WHEN 500 THEN 'shipped'
                 WHEN 501 THEN 'out_for_delivery'
                 WHEN 502 THEN 'delivered'
                 ELSE 'shipped' END;
    expected_label:=CASE ev WHEN 'shipped' THEN 'Shipped'
                    WHEN 'out_for_delivery' THEN 'Out for Delivery'
                    ELSE 'Delivered' END;
    claimed:=public.claim_whatsapp_shipping_event(eid,ev,cutoff_time);
    IF claimed IS NULL OR (claimed->>'statusLabel') IS DISTINCT FROM expected_label
    THEN RAISE EXCEPTION 'Valid shipping event % not claimed properly',eid; END IF;
    IF public.claim_whatsapp_shipping_event(eid,ev,cutoff_time) IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate shipping provider attempt for %',eid;
    END IF;
    IF eid=500 THEN
      IF NOT public.finish_whatsapp_order_confirmation(
          (claimed->>'outboxId')::bigint,'wamid.synthetic-shipping-500',NULL)
      THEN RAISE EXCEPTION 'Shipment provider acknowledgement not stored'; END IF;
      IF public.finish_whatsapp_order_confirmation(
          (claimed->>'outboxId')::bigint,'wamid.synthetic-duplicate',NULL)
      THEN RAISE EXCEPTION 'Shipping receipt was overwritten'; END IF;
    END IF;
  END LOOP;

  -- Both claim functions MUST share the same 5/hour cap.
  claimed:=public.claim_whatsapp_order_confirmation(510,cutoff_time);
  IF claimed IS NULL THEN RAISE EXCEPTION 'Fifth shared claim failed'; END IF;
  IF public.claim_whatsapp_shipping_event(504,'shipped',cutoff_time) IS NOT NULL
  THEN RAISE EXCEPTION 'Shipping bypassed shared hourly cap'; END IF;
  SELECT count(*) INTO i FROM public.whatsapp_order_notification_outbox
  WHERE attempt_started_at>=now()-interval '1 hour';
  IF i<>5 THEN RAISE EXCEPTION 'Unexpected shared first-attempt count: %',i; END IF;

  IF pg_catalog.has_function_privilege(
      'anon','public.claim_whatsapp_shipping_event(bigint,text,timestamptz)','EXECUTE')
    OR pg_catalog.has_function_privilege(
      'authenticated','public.claim_whatsapp_shipping_event(bigint,text,timestamptz)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege(
      'service_role','public.claim_whatsapp_shipping_event(bigint,text,timestamptz)','EXECUTE')
  THEN RAISE EXCEPTION 'Shipping claim RPC grants unsafe'; END IF;
  RAISE NOTICE 'PASS shipping events, verified prepaid, COD collected, no consent/awb/stale, idempotency, shared quota, grants';
END;
$shipping$;
ROLLBACK;

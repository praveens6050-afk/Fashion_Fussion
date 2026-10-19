-- Isolated CI assertion for seller order-alert privacy and safe routing.
DO $test$
DECLARE
  rls boolean;
BEGIN
  SELECT c.relrowsecurity INTO rls
  FROM pg_catalog.pg_class c
  WHERE c.oid='public.whatsapp_seller_order_notification_outbox'::regclass;
  IF rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Seller order alert outbox must enforce RLS';
  END IF;
  IF has_table_privilege('anon','public.whatsapp_seller_order_notification_outbox','SELECT')
     OR has_table_privilege('authenticated','public.whatsapp_seller_order_notification_outbox','SELECT') THEN
    RAISE EXCEPTION 'Browser roles must not read seller notification outbox';
  END IF;
  IF NOT has_table_privilege('service_role','public.whatsapp_seller_order_notification_outbox','INSERT') THEN
    RAISE EXCEPTION 'Service role must have outbox insert access';
  END IF;
  IF has_function_privilege('anon','public.stage_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE')
     OR has_function_privilege('authenticated','public.stage_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser roles must not stage seller alerts';
  END IF;
  IF NOT has_function_privilege('service_role','public.stage_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE') THEN
    RAISE EXCEPTION 'Service role must stage seller alerts';
  END IF;
  IF public.stage_whatsapp_seller_order_alert(1,now()-interval '1 hour') <> 0 THEN
    RAISE EXCEPTION 'Nonexistent/unmapped orders must not stage seller alerts';
  END IF;

  INSERT INTO auth.users(id,email) VALUES
    ('10000000-0000-4000-8000-000000000001','seller-ci@example.invalid');
  INSERT INTO public.profiles(id,phone,phone_verified_at,is_admin)
  VALUES ('10000000-0000-4000-8000-000000000001','+918765432109',now(),false);
  INSERT INTO public.seller_profiles(user_id,phone,phone_verified_at,status)
  VALUES ('10000000-0000-4000-8000-000000000001','+918765432109',now(),'active');
  INSERT INTO public.products(id,is_active) VALUES (501,true);
  INSERT INTO public.seller_product_submissions(seller_id,approved_product_id,status)
  VALUES ('10000000-0000-4000-8000-000000000001',501,'approved');
  INSERT INTO public.whatsapp_contact_consents(phone_e164,purpose,status,source,proof_reference,consented_at)
  VALUES ('+918765432109','transactional','opted_in','seller_settings','synthetic-ci-proof',now());
  INSERT INTO public.orders(id,user_id,status,fulfillment_status,payment_method,payment_verified_at,created_at,items)
  VALUES (987101,'20000000-0000-4000-8000-000000000002','paid','ordered','prepaid',now(),now(),
    '[{"id":501,"variant_id":null,"qty":1}]'::jsonb);

  IF public.stage_whatsapp_seller_order_alert(987101,now()-interval '1 hour') <> 1 THEN
    RAISE EXCEPTION 'Eligible approved seller order should stage once';
  END IF;
  IF public.stage_whatsapp_seller_order_alert(987101,now()-interval '1 hour') <> 0 THEN
    RAISE EXCEPTION 'Duplicate seller order event must be idempotent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_seller_order_notification_outbox
    WHERE order_id=987101 AND seller_id='10000000-0000-4000-8000-000000000001'
      AND status='pending_review' AND attempt_count=0
  ) THEN
    RAISE EXCEPTION 'Seller outbox must target the verified seller and remain unsent';
  END IF;


  IF has_function_privilege('anon','public.claim_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE')
     OR has_function_privilege('authenticated','public.claim_whatsapp_seller_order_alert(bigint,timestamp with time zone)','EXECUTE')
     OR has_function_privilege('anon','public.finish_whatsapp_seller_order_alert(bigint,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.finish_whatsapp_seller_order_alert(bigint,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser roles must not claim or finish seller alerts';
  END IF;
  UPDATE public.whatsapp_seller_order_notification_outbox SET status='ready' WHERE order_id=987101;
  IF (public.claim_whatsapp_seller_order_alert(
       (SELECT id FROM public.whatsapp_seller_order_notification_outbox WHERE order_id=987101),
       now()-interval '1 hour')->>'recipientPhone') <> '+918765432109' THEN
    RAISE EXCEPTION 'Atomic seller claim must return the verified seller phone';
  END IF;
  IF public.claim_whatsapp_seller_order_alert(
       (SELECT id FROM public.whatsapp_seller_order_notification_outbox WHERE order_id=987101),
       now()-interval '1 hour') IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate seller alert claim must be rejected';
  END IF;
  IF NOT public.finish_whatsapp_seller_order_alert(
       (SELECT id FROM public.whatsapp_seller_order_notification_outbox WHERE order_id=987101),
       'wamid.seller-ci',NULL) THEN
    RAISE EXCEPTION 'Seller provider acknowledgement must be saved';
  END IF;
  IF public.finish_whatsapp_seller_order_alert(
       (SELECT id FROM public.whatsapp_seller_order_notification_outbox WHERE order_id=987101),
       'wamid.seller-ci',NULL) THEN
    RAISE EXCEPTION 'Duplicate seller finish must be rejected';
  END IF;

  UPDATE public.whatsapp_contact_consents SET revoked_at=now(),status='opted_out'
  WHERE phone_e164='+918765432109' AND purpose='transactional';
  INSERT INTO public.orders(id,user_id,status,fulfillment_status,payment_method,payment_verified_at,created_at,items)
  VALUES (987102,'20000000-0000-4000-8000-000000000002','paid','ordered','prepaid',now(),now(),
    '[{"id":501,"variant_id":null,"qty":1}]'::jsonb);
  IF public.stage_whatsapp_seller_order_alert(987102,now()-interval '1 hour') <> 0 THEN
    RAISE EXCEPTION 'Revoked seller consent must block staging';
  END IF;

END
$test$;

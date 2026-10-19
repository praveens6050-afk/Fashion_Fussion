-- Isolated assertions for internal WhatsApp support queue routing.
DO $test$
BEGIN
  INSERT INTO public.whatsapp_inbound_events
    (external_message_id,sender_phone,sender_role,classification_source,routing_status,message_type)
  VALUES
    ('wamid-ci-customer','919111111111','customer','profiles.phone','classified','text'),
    ('wamid-ci-seller','919222222222','seller','seller_profiles.active','classified','text'),
    ('wamid-ci-admin','919333333333','admin','profiles.is_admin','classified','text'),
    ('wamid-ci-unknown','919444444444','unclassified','none','needs_review','text');

  IF (SELECT support_team FROM public.whatsapp_inbound_events WHERE external_message_id='wamid-ci-customer') <> 'customer_support' THEN
    RAISE EXCEPTION 'Customer inbound message must route to customer support';
  END IF;
  IF (SELECT support_team FROM public.whatsapp_inbound_events WHERE external_message_id='wamid-ci-seller') <> 'seller_support' THEN
    RAISE EXCEPTION 'Seller inbound message must route to seller support';
  END IF;
  IF (SELECT support_team FROM public.whatsapp_inbound_events WHERE external_message_id='wamid-ci-admin') <> 'admin_operations' THEN
    RAISE EXCEPTION 'Admin inbound message must route to admin operations';
  END IF;
  IF (SELECT support_team FROM public.whatsapp_inbound_events WHERE external_message_id='wamid-ci-unknown') <> 'sales_marketing'
     OR (SELECT routing_status FROM public.whatsapp_inbound_events WHERE external_message_id='wamid-ci-unknown') <> 'needs_review' THEN
    RAISE EXCEPTION 'Unknown inbound message must be triaged without being trusted';
  END IF;

  UPDATE public.whatsapp_inbound_events SET support_team='admin_operations'
  WHERE external_message_id='wamid-ci-customer';
  IF (SELECT support_team FROM public.whatsapp_inbound_events WHERE external_message_id='wamid-ci-customer') <> 'customer_support' THEN
    RAISE EXCEPTION 'Client-supplied team assignment must be overwritten by the server trigger';
  END IF;
END
$test$;

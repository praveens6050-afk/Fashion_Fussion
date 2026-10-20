-- Extend the signed Meta delivery receipt recorder to update CRM support replies too.
BEGIN;
CREATE OR REPLACE FUNCTION public.record_whatsapp_delivery_status(
 p_provider_message_id text,p_meta_status text,p_event_at timestamptz,p_error_code text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE v_new_event integer:=0;v_matched_order integer:=0;v_matched_support integer:=0;
BEGIN
 IF p_provider_message_id IS NULL OR length(p_provider_message_id) NOT BETWEEN 5 AND 255
  OR p_provider_message_id !~ '^wamid[.]'
  OR p_meta_status NOT IN ('sent','delivered','read','failed')
  OR p_event_at IS NULL OR p_event_at>now()+interval '5 minutes'
  OR p_event_at<timestamp with time zone '2020-01-01'
  OR length(coalesce(p_error_code,''))>64
 THEN RAISE EXCEPTION 'Invalid WhatsApp delivery status event' USING errcode='22023'; END IF;
 INSERT INTO public.whatsapp_delivery_status_events(provider_message_id,meta_status,event_at,error_code)
 VALUES(p_provider_message_id,p_meta_status,p_event_at,p_error_code)
 ON CONFLICT(provider_message_id,meta_status,event_at) DO NOTHING;
 GET DIAGNOSTICS v_new_event=ROW_COUNT;
 IF v_new_event=0 THEN
  RETURN jsonb_build_object('recorded',false,'duplicate',true,'matched_order',false,'matched_support_reply',false);
 END IF;
 UPDATE public.whatsapp_order_notification_outbox o SET
  provider_sent_at=CASE WHEN p_meta_status='sent' THEN greatest(o.provider_sent_at,p_event_at) ELSE o.provider_sent_at END,
  provider_delivered_at=CASE WHEN p_meta_status IN ('delivered','read') THEN greatest(o.provider_delivered_at,p_event_at) ELSE o.provider_delivered_at END,
  provider_read_at=CASE WHEN p_meta_status='read' THEN greatest(o.provider_read_at,p_event_at) ELSE o.provider_read_at END,
  provider_failed_at=CASE WHEN p_meta_status='failed' THEN greatest(o.provider_failed_at,p_event_at) ELSE o.provider_failed_at END,
  last_provider_status=CASE WHEN p_meta_status='read' THEN 'read'
   WHEN p_meta_status='delivered' THEN CASE WHEN o.last_provider_status='read' THEN 'read' ELSE 'delivered' END
   WHEN p_meta_status='sent' THEN CASE WHEN o.last_provider_status IN ('delivered','read','failed') THEN o.last_provider_status ELSE 'sent' END
   WHEN p_meta_status='failed' THEN CASE WHEN o.last_provider_status IN ('delivered','read') THEN o.last_provider_status ELSE 'failed' END END,
  status=CASE WHEN p_meta_status IN ('delivered','read') THEN 'delivered'
   WHEN p_meta_status='failed' AND o.status<>'delivered' THEN 'failed'
   WHEN p_meta_status='sent' AND o.status IN ('sending','accepted') THEN 'accepted' ELSE o.status END,
  last_error_code=CASE WHEN p_meta_status='failed' AND o.status<>'delivered' THEN p_error_code ELSE o.last_error_code END,
  updated_at=now()
 WHERE o.provider_message_id=p_provider_message_id;
 GET DIAGNOSTICS v_matched_order=ROW_COUNT;
 UPDATE public.whatsapp_support_reply_outbox r SET
  status=CASE WHEN p_meta_status='delivered' THEN 'delivered'
   WHEN p_meta_status='read' THEN 'read'
   WHEN p_meta_status='failed' AND r.status NOT IN ('delivered','read') THEN 'failed'
   WHEN p_meta_status='sent' AND r.status='accepted' THEN 'accepted'
   ELSE r.status END,
  last_error_code=CASE WHEN p_meta_status='failed' AND r.status NOT IN ('delivered','read') THEN p_error_code ELSE r.last_error_code END,
  updated_at=now()
 WHERE r.provider_message_id=p_provider_message_id;
 GET DIAGNOSTICS v_matched_support=ROW_COUNT;
 RETURN jsonb_build_object('recorded',true,'duplicate',false,'matched_order',v_matched_order=1,'matched_support_reply',v_matched_support=1);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_whatsapp_delivery_status(text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_delivery_status(text,text,timestamptz,text) TO service_role;
COMMIT;

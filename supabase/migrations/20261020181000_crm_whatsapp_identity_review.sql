-- Explicit admin identity review for inbound WhatsApp conversations.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_crm_classify_whatsapp_event(
 p_inbound_event_id bigint,p_sender_role text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_admin boolean:=false; v_row public.whatsapp_inbound_events%rowtype;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 IF NOT coalesce(v_admin,false) THEN RAISE EXCEPTION 'Administrator identity review required' USING errcode='42501'; END IF;
 IF p_inbound_event_id IS NULL OR p_inbound_event_id<=0
    OR p_sender_role NOT IN ('customer','seller','admin')
 THEN RAISE EXCEPTION 'Invalid identity classification' USING errcode='22023'; END IF;
 UPDATE public.whatsapp_inbound_events
 SET sender_role=p_sender_role,sender_user_id=NULL,classification_source='crm_manual_review',
     routing_status='classified'
 WHERE id=p_inbound_event_id AND routing_status='needs_review' AND sender_role='unclassified'
 RETURNING * INTO v_row;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is not awaiting identity review' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('classified',true,'eventId',v_row.id,'senderRole',v_row.sender_role,
   'team',v_row.support_team,'message','Identity classification saved; no message sent.');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_classify_whatsapp_event(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_classify_whatsapp_event(bigint,text) TO authenticated;
COMMIT;

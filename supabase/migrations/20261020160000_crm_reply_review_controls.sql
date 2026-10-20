-- Explicit administrator approval before a future private dispatcher may send CRM replies.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_crm_approve_whatsapp_reply(p_reply_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_admin boolean:=false; v_row public.whatsapp_support_reply_outbox%rowtype;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 IF NOT coalesce(v_admin,false) THEN RAISE EXCEPTION 'Administrator review required' USING errcode='42501'; END IF;
 UPDATE public.whatsapp_support_reply_outbox r SET status='ready',updated_at=now()
 WHERE r.id=p_reply_id AND r.status='pending_review' AND r.attempt_count=0
 AND EXISTS(SELECT 1 FROM public.whatsapp_inbound_events e WHERE e.id=r.inbound_event_id
   AND e.routing_status='classified' AND e.sender_role<>'unclassified'
   AND e.created_at>=now()-interval '24 hours')
 RETURNING * INTO v_row;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reply cannot be approved: it may be stale, reviewed already, or identity-unverified' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('approved',true,'replyId',v_row.id,'status',v_row.status,
  'message','Reply approved for the separately gated dispatcher; this action did not send it.');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_approve_whatsapp_reply(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_approve_whatsapp_reply(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_crm_approve_email_reply(p_reply_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_admin boolean:=false; v_row public.crm_email_reply_outbox%rowtype;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 IF NOT coalesce(v_admin,false) THEN RAISE EXCEPTION 'Administrator review required' USING errcode='42501'; END IF;
 UPDATE public.crm_email_reply_outbox r SET status='ready',updated_at=now()
 WHERE r.id=p_reply_id AND r.status='pending_review' AND r.attempt_count=0
 AND EXISTS(SELECT 1 FROM public.crm_email_inbound_events e WHERE e.id=r.inbound_event_id
   AND e.routing_status='classified' AND e.received_at>=now()-interval '90 days');
 RETURNING * INTO v_row;
 IF NOT FOUND THEN RAISE EXCEPTION 'Email reply cannot be approved: identity review is required or item is no longer pending' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('approved',true,'replyId',v_row.id,'status',v_row.status,
  'message','Email reply approved for the separately gated Zoho dispatcher; this action did not send it.');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_approve_email_reply(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_approve_email_reply(bigint) TO authenticated;
COMMIT;

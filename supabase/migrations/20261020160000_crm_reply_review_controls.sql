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
   AND e.routing_status='classified' AND e.received_at>=now()-interval '90 days')
 RETURNING * INTO v_row;
 IF NOT FOUND THEN RAISE EXCEPTION 'Email reply cannot be approved: identity review is required or item is no longer pending' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('approved',true,'replyId',v_row.id,'status',v_row.status,
  'message','Email reply approved for the separately gated Zoho dispatcher; this action did not send it.');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_approve_email_reply(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_approve_email_reply(bigint) TO authenticated;

-- Include latest reply review state so the inbox can show the admin approval control.
CREATE OR REPLACE FUNCTION public.admin_crm_email_support_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_team text; v_uid uuid:=auth.uid(); v_admin boolean:=false;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 v_team:=public.crm_whatsapp_actor_team();
 RETURN jsonb_build_object(
  'actor_team',v_team,'is_admin',coalesce(v_admin,false),'generated_at',now(),
  'recent',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.received_at DESC)
   FROM (SELECT e.id,e.sender_email,e.recipient_email,e.subject,e.message_text,e.support_team,e.routing_status,e.received_at,
      (SELECT r.status FROM public.crm_email_reply_outbox r WHERE r.inbound_event_id=e.id ORDER BY r.created_at DESC LIMIT 1) AS latest_reply_status,
      (SELECT r.id FROM public.crm_email_reply_outbox r WHERE r.inbound_event_id=e.id ORDER BY r.created_at DESC LIMIT 1) AS latest_reply_id
     FROM public.crm_email_inbound_events e WHERE (v_admin OR e.support_team=v_team)
     ORDER BY e.received_at DESC LIMIT 100) t),'[]'::jsonb),
  'queues',jsonb_build_object(
   'customer_support',(SELECT count(*) FROM public.crm_email_inbound_events WHERE support_team='customer_support' AND (v_admin OR support_team=v_team)),
   'seller_support',(SELECT count(*) FROM public.crm_email_inbound_events WHERE support_team='seller_support' AND (v_admin OR support_team=v_team)),
   'sales_marketing',(SELECT count(*) FROM public.crm_email_inbound_events WHERE support_team='sales_marketing' AND (v_admin OR support_team=v_team)),
   'admin_operations',(SELECT count(*) FROM public.crm_email_inbound_events WHERE support_team='admin_operations' AND (v_admin OR support_team=v_team))
  )
 );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_email_support_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_email_support_snapshot() TO authenticated;

COMMIT;

-- Store the selected approved sender mailbox on reviewed CRM email replies.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_crm_queue_email_reply(
 p_inbound_event_id bigint,p_reply_text text,p_request_key text,p_from_email text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_admin boolean:=false; v_team text;
 v_event public.crm_email_inbound_events%rowtype; v_id bigint;
 v_from text:=lower(btrim(coalesce(p_from_email,'')));
 v_expected text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 v_team:=public.crm_whatsapp_actor_team();
 IF p_inbound_event_id IS NULL OR p_inbound_event_id<=0
   OR p_reply_text IS NULL OR length(btrim(p_reply_text)) NOT BETWEEN 1 AND 10000
   OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9._:-]{8,160}$'
   OR v_from NOT IN ('customer.care@fashionfussion.in','seller.support@fashionfussion.in',
      'sales.team@fashionfussion.in','orders@fashionfussion.in')
 THEN RAISE EXCEPTION 'Invalid reply request' USING errcode='22023'; END IF;
 SELECT * INTO v_event FROM public.crm_email_inbound_events
 WHERE id=p_inbound_event_id AND (v_admin OR support_team=v_team);
 IF NOT FOUND OR v_event.routing_status<>'classified'
 THEN RAISE EXCEPTION 'Email conversation requires identity review or is outside your queue' USING errcode='42501'; END IF;
 v_expected:=CASE v_event.support_team
   WHEN 'customer_support' THEN 'customer.care@fashionfussion.in'
   WHEN 'seller_support' THEN 'seller.support@fashionfussion.in'
   WHEN 'sales_marketing' THEN 'sales.team@fashionfussion.in'
   WHEN 'admin_operations' THEN 'orders@fashionfussion.in'
   ELSE NULL END;
 IF (NOT v_admin AND v_from IS DISTINCT FROM v_expected)
   OR (v_from='orders@fashionfussion.in' AND v_event.support_team<>'admin_operations')
 THEN RAISE EXCEPTION 'Selected reply mailbox is not allowed for this queue' USING errcode='42501'; END IF;
 INSERT INTO public.crm_email_reply_outbox(inbound_event_id,request_key,from_email,to_email,subject,message_text,requested_by,status)
 VALUES(v_event.id,p_request_key,v_from,v_event.sender_email,
   CASE WHEN left(v_event.subject,4) ILIKE 'Re: ' THEN v_event.subject ELSE 'Re: '||v_event.subject END,
   btrim(p_reply_text),v_uid,'pending_review')
 ON CONFLICT(request_key) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN
  SELECT id INTO v_id FROM public.crm_email_reply_outbox
  WHERE request_key=p_request_key AND inbound_event_id=v_event.id AND requested_by=v_uid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Request key already used' USING errcode='23505'; END IF;
 END IF;
 RETURN jsonb_build_object('queued',true,'replyId',v_id,'status','pending_review',
   'message','Email reply queued for review; no email was sent.');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_queue_email_reply(bigint,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_queue_email_reply(bigint,text,text,text) TO authenticated;
COMMIT;

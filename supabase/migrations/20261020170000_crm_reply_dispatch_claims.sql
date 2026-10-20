-- Atomic one-attempt claims for reviewed CRM replies. Provider calls are performed by gated server-side dispatchers.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_crm_email_reply(p_reply_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_row public.crm_email_reply_outbox%rowtype;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Server integration access required' USING errcode='42501'; END IF;
 UPDATE public.crm_email_reply_outbox r SET status='sending',attempt_count=1,attempt_started_at=now(),updated_at=now()
 WHERE r.id=p_reply_id AND r.status='ready' AND r.attempt_count=0
 AND r.created_at>=now()-interval '7 days'
 RETURNING r.* INTO v_row;
 IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','not_ready_or_already_attempted'); END IF;
 RETURN jsonb_build_object('claimed',true,'id',v_row.id,'toEmail',v_row.to_email,'fromEmail',v_row.from_email,
  'subject',v_row.subject,'text',v_row.message_text,'attemptCount',v_row.attempt_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_crm_email_reply(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_email_reply(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_crm_email_reply(p_reply_id bigint,p_provider_message_id text,p_error_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_status text;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Server integration access required' USING errcode='42501'; END IF;
 IF p_provider_message_id IS NOT NULL AND (length(p_provider_message_id)>255 OR length(p_provider_message_id)<1)
 THEN RAISE EXCEPTION 'Invalid provider message ID' USING errcode='22023'; END IF;
 IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z0-9_:-]{1,64}$'
 THEN RAISE EXCEPTION 'Invalid error code' USING errcode='22023'; END IF;
 UPDATE public.crm_email_reply_outbox SET
   status=CASE WHEN p_provider_message_id IS NOT NULL THEN 'accepted' ELSE 'failed' END,
   provider_message_id=p_provider_message_id,last_error_code=p_error_code,updated_at=now()
 WHERE id=p_reply_id AND status='sending' AND attempt_count=1
 RETURNING status INTO v_status;
 RETURN jsonb_build_object('finished',v_status IS NOT NULL,'status',v_status,'retryAllowed',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.finish_crm_email_reply(bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_crm_email_reply(bigint,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_crm_whatsapp_reply(p_reply_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_row public.whatsapp_support_reply_outbox%rowtype; v_event public.whatsapp_inbound_events%rowtype;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Server integration access required' USING errcode='42501'; END IF;
 UPDATE public.whatsapp_support_reply_outbox r SET status='sending',attempt_count=1,attempt_started_at=now(),updated_at=now()
 WHERE r.id=p_reply_id AND r.status='ready' AND r.attempt_count=0
 RETURNING r.* INTO v_row;
 IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','not_ready_or_already_attempted'); END IF;
 SELECT * INTO v_event FROM public.whatsapp_inbound_events WHERE id=v_row.inbound_event_id;
 IF NOT FOUND OR v_event.routing_status<>'classified' OR v_event.sender_role='unclassified'
   OR coalesce(v_event.meta_timestamp,v_event.created_at)<now()-interval '24 hours' THEN
   UPDATE public.whatsapp_support_reply_outbox SET status='blocked',last_error_code='REPLY_WINDOW_EXPIRED',updated_at=now() WHERE id=v_row.id;
   RETURN jsonb_build_object('claimed',false,'reason','reply_window_expired_or_identity_review_required');
 END IF;
 RETURN jsonb_build_object('claimed',true,'id',v_row.id,'toPhone',v_row.recipient_phone,
   'text',v_row.reply_text,'inboundEventId',v_event.id,'phoneNumberId',v_event.phone_number_id,'attemptCount',v_row.attempt_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_crm_whatsapp_reply(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_whatsapp_reply(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_crm_whatsapp_reply(p_reply_id bigint,p_provider_message_id text,p_error_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_status text;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Server integration access required' USING errcode='42501'; END IF;
 IF p_provider_message_id IS NOT NULL AND (length(p_provider_message_id)>255 OR p_provider_message_id !~ '^wamid[.][^[:space:]]+$')
 THEN RAISE EXCEPTION 'Invalid provider message ID' USING errcode='22023'; END IF;
 IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z0-9_:-]{1,64}$'
 THEN RAISE EXCEPTION 'Invalid error code' USING errcode='22023'; END IF;
 UPDATE public.whatsapp_support_reply_outbox SET
   status=CASE WHEN p_provider_message_id IS NOT NULL THEN 'accepted' ELSE 'failed' END,
   provider_message_id=p_provider_message_id,last_error_code=p_error_code,updated_at=now()
 WHERE id=p_reply_id AND status='sending' AND attempt_count=1
 RETURNING status INTO v_status;
 RETURN jsonb_build_object('finished',v_status IS NOT NULL,'status',v_status,'retryAllowed',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.finish_crm_whatsapp_reply(bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_crm_whatsapp_reply(bigint,text,text) TO service_role;
COMMIT;

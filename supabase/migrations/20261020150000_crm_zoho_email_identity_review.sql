-- Explicit identity/routing review for incoming CRM email.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_crm_classify_email_event(p_inbound_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_admin boolean:=false; v_team text; v_event public.crm_email_inbound_events%rowtype;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 v_team:=public.crm_whatsapp_actor_team();
 UPDATE public.crm_email_inbound_events e SET routing_status='classified'
 WHERE e.id=p_inbound_event_id AND (v_admin OR e.support_team=v_team)
 RETURNING e.* INTO v_event;
 IF NOT FOUND THEN RAISE EXCEPTION 'Email event is unavailable or outside your queue' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('classified',true,'eventId',v_event.id,'team',v_event.support_team);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_classify_email_event(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_classify_email_event(bigint) TO authenticated;
COMMIT;

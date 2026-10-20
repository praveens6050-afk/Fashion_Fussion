-- Team-scoped CRM WhatsApp access. Existing admin access is retained.
-- No team member can query another team's conversations or queue replies to them.
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_team_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  team_key text NOT NULL CHECK (team_key IN ('customer_support','seller_support','sales_marketing')),
  active boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_team_members FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.crm_team_members TO service_role;

CREATE OR REPLACE FUNCTION public.crm_whatsapp_actor_team()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_admin boolean := false; v_team text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
  SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
  IF coalesce(v_admin,false) THEN RETURN 'admin_operations'; END IF;
  SELECT m.team_key INTO v_team FROM public.crm_team_members m
    WHERE m.user_id=v_uid AND m.active=true;
  IF v_team IS NULL THEN RAISE EXCEPTION 'CRM team access required' USING errcode='42501'; END IF;
  RETURN v_team;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_whatsapp_actor_team() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_actor_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_crm_whatsapp_support_snapshot()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_admin boolean := false; v_team text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
  SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
  v_team := public.crm_whatsapp_actor_team();
  RETURN jsonb_build_object(
    'generated_at',now(),'actor_team',v_team,'is_admin',coalesce(v_admin,false),
    'queues',jsonb_build_object(
      'customer_support',(SELECT count(*) FROM public.whatsapp_inbound_events WHERE support_team='customer_support' AND (v_admin OR support_team=v_team)),
      'seller_support',(SELECT count(*) FROM public.whatsapp_inbound_events WHERE support_team='seller_support' AND (v_admin OR support_team=v_team)),
      'sales_marketing',(SELECT count(*) FROM public.whatsapp_inbound_events WHERE support_team='sales_marketing' AND (v_admin OR support_team=v_team)),
      'admin_operations',(SELECT count(*) FROM public.whatsapp_inbound_events WHERE v_admin AND support_team='admin_operations'),
      'needs_review',(SELECT count(*) FROM public.whatsapp_inbound_events WHERE routing_status='needs_review' AND (v_admin OR support_team=v_team))
    ),
    'recent',coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT e.id,e.sender_phone,e.sender_role,e.routing_status,e.support_team,
               e.message_type,e.message_text,e.created_at,
               (SELECT r.status FROM public.whatsapp_support_reply_outbox r
                WHERE r.inbound_event_id=e.id ORDER BY r.created_at DESC LIMIT 1) AS latest_reply_status,
               (SELECT r.id FROM public.whatsapp_support_reply_outbox r
                WHERE r.inbound_event_id=e.id ORDER BY r.created_at DESC LIMIT 1) AS latest_reply_id
        FROM public.whatsapp_inbound_events e
        WHERE (v_admin OR e.support_team=v_team)
        ORDER BY e.created_at DESC LIMIT 100
      ) t
    ),'[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_whatsapp_support_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_whatsapp_support_snapshot() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_crm_queue_whatsapp_reply(
 p_inbound_event_id bigint,p_reply_text text,p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
 v_uid uuid := auth.uid(); v_admin boolean := false; v_team text;
 v_event public.whatsapp_inbound_events%rowtype; v_id bigint;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 v_team := public.crm_whatsapp_actor_team();
 IF p_inbound_event_id IS NULL OR p_inbound_event_id<=0
    OR p_reply_text IS NULL OR length(btrim(p_reply_text)) NOT BETWEEN 1 AND 1000
    OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9._:-]{8,160}$'
 THEN RAISE EXCEPTION 'Invalid reply request' USING errcode='22023'; END IF;
 SELECT * INTO v_event FROM public.whatsapp_inbound_events WHERE id=p_inbound_event_id
   AND (v_admin OR support_team=v_team);
 IF NOT FOUND OR v_event.routing_status<>'classified' OR v_event.sender_role='unclassified'
 THEN RAISE EXCEPTION 'Conversation is unavailable or requires identity review' USING errcode='42501'; END IF;
 INSERT INTO public.whatsapp_support_reply_outbox
   (inbound_event_id,request_key,recipient_phone,reply_text,requested_by,status)
 VALUES (v_event.id,p_request_key,regexp_replace(v_event.sender_phone,'[^0-9]','','g'),btrim(p_reply_text),v_uid,'pending_review')
 ON CONFLICT (request_key) DO NOTHING
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN
   SELECT id INTO v_id FROM public.whatsapp_support_reply_outbox
    WHERE request_key=p_request_key AND inbound_event_id=v_event.id AND requested_by=v_uid;
   IF v_id IS NULL THEN RAISE EXCEPTION 'Request key already used' USING errcode='23505'; END IF;
 END IF;
 RETURN jsonb_build_object('queued',v_id IS NOT NULL,'status','pending_review','replyId',v_id,
   'message','Reply queued for authorized review; no WhatsApp message was sent.');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_queue_whatsapp_reply(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_queue_whatsapp_reply(bigint,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_crm_set_whatsapp_team_member(
 p_user_id uuid,p_team_key text,p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_admin boolean := false;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 SELECT coalesce(p.is_admin,false) INTO v_admin FROM public.profiles p WHERE p.id=v_uid;
 IF NOT coalesce(v_admin,false) THEN RAISE EXCEPTION 'Administrator access required' USING errcode='42501'; END IF;
 IF p_user_id IS NULL OR p_team_key NOT IN ('customer_support','seller_support','sales_marketing') OR p_active IS NULL
 THEN RAISE EXCEPTION 'Invalid team assignment' USING errcode='22023'; END IF;
 INSERT INTO public.crm_team_members(user_id,team_key,active,granted_by,updated_at)
 VALUES(p_user_id,p_team_key,p_active,v_uid,now())
 ON CONFLICT(user_id) DO UPDATE SET team_key=EXCLUDED.team_key,active=EXCLUDED.active,
   granted_by=EXCLUDED.granted_by,updated_at=now();
 RETURN jsonb_build_object('updated',true,'team',p_team_key,'active',p_active);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_set_whatsapp_team_member(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_set_whatsapp_team_member(uuid,text,boolean) TO authenticated;

COMMIT;

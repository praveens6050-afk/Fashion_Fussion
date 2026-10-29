-- Align the legacy WhatsApp inbox helpers with the canonical CRM team roster.
-- crm_team_members uses role/is_active/email, not team_key/active.
BEGIN;

CREATE OR REPLACE FUNCTION public.crm_whatsapp_actor_team()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean := false;
  v_role text;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode='28000';
  END IF;

  SELECT coalesce(p.is_admin,false) INTO v_admin
  FROM public.profiles p WHERE p.id=v_uid;

  IF coalesce(v_admin,false) THEN
    RETURN 'admin_operations';
  END IF;

  SELECT lower(btrim(u.email)) INTO v_email
  FROM auth.users u WHERE u.id=v_uid;

  SELECT m.role INTO v_role
  FROM public.crm_team_members m
  WHERE m.user_id=v_uid
    AND m.is_active IS TRUE
    AND lower(btrim(m.email))=coalesce(v_email,'');

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'CRM team access required' USING errcode='42501';
  END IF;

  RETURN CASE
    WHEN v_role IN ('sales','marketing') THEN 'sales_marketing'
    ELSE v_role
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_whatsapp_actor_team() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_actor_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_crm_set_whatsapp_team_member(
  p_user_id uuid,
  p_team_key text,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean := false;
  v_email text;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode='28000';
  END IF;

  SELECT coalesce(p.is_admin,false) INTO v_admin
  FROM public.profiles p WHERE p.id=v_uid;
  IF NOT coalesce(v_admin,false) THEN
    RAISE EXCEPTION 'Administrator access required' USING errcode='42501';
  END IF;

  IF p_user_id IS NULL
    OR p_team_key NOT IN ('customer_support','seller_support','sales_marketing')
    OR p_active IS NULL
  THEN
    RAISE EXCEPTION 'Invalid team assignment' USING errcode='22023';
  END IF;

  SELECT lower(btrim(u.email)) INTO v_email
  FROM auth.users u WHERE u.id=p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Auth user not found' USING errcode='22023';
  END IF;

  v_role := CASE WHEN p_team_key='sales_marketing' THEN 'sales' ELSE p_team_key END;

  INSERT INTO public.crm_team_members(user_id,email,role,is_active,invited_by,updated_at)
  VALUES(p_user_id,v_email,v_role,p_active,v_uid,now())
  ON CONFLICT(user_id) DO UPDATE SET
    email=EXCLUDED.email,
    role=EXCLUDED.role,
    is_active=EXCLUDED.is_active,
    invited_by=EXCLUDED.invited_by,
    updated_at=now();

  RETURN jsonb_build_object(
    'updated',true,
    'team',p_team_key,
    'role',v_role,
    'active',p_active
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_crm_set_whatsapp_team_member(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_set_whatsapp_team_member(uuid,text,boolean) TO authenticated;

COMMIT;

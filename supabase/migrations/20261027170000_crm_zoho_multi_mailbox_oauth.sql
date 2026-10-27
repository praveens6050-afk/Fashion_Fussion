-- Support one Zoho OAuth grant per independently hosted department mailbox.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

ALTER TABLE public.crm_zoho_oauth_states
  ADD COLUMN IF NOT EXISTS mailbox_address text,
  ADD COLUMN IF NOT EXISTS department text;

DROP FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz);
DROP FUNCTION public.crm_consume_zoho_oauth_state(text);

CREATE TABLE IF NOT EXISTS private.crm_zoho_mailbox_configs (
  mailbox_address text PRIMARY KEY,
  department text NOT NULL CHECK (department = ANY (ARRAY['customer_support','seller_support','sales','orders']::text[])),
  zoho_account_id text NOT NULL,
  vault_secret_name text NOT NULL UNIQUE,
  connected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.crm_zoho_mailbox_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.crm_zoho_mailbox_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.crm_zoho_mailbox_configs TO service_role;

CREATE OR REPLACE FUNCTION public.crm_create_zoho_oauth_state(
  p_state_hash text,
  p_actor_user_id uuid,
  p_expires_at timestamptz,
  p_mailbox_address text,
  p_department text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_address text := lower(trim(coalesce(p_mailbox_address, '')));
  v_department text := lower(trim(coalesce(p_department, '')));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid state hash'; END IF;
  IF p_expires_at <= clock_timestamp() OR p_expires_at > clock_timestamp() + interval '15 minutes' THEN RAISE EXCEPTION 'invalid state expiry'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_user_id AND is_admin IS TRUE) THEN RAISE EXCEPTION 'administrator required'; END IF;
  IF NOT (
    (v_address = 'customer.care@fashionfussion.in' AND v_department = 'customer_support') OR
    (v_address = 'seller.support@fashionfussion.in' AND v_department = 'seller_support') OR
    (v_address = 'sales@fashionfussion.in' AND v_department = 'sales') OR
    (v_address = 'orders@fashionfussion.in' AND v_department = 'orders')
  ) THEN RAISE EXCEPTION 'mailbox and department do not match'; END IF;

  DELETE FROM public.crm_zoho_oauth_states WHERE expires_at <= clock_timestamp();
  INSERT INTO public.crm_zoho_oauth_states (state_hash, actor_user_id, expires_at, mailbox_address, department)
  VALUES (p_state_hash, p_actor_user_id, p_expires_at, v_address, v_department);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_consume_zoho_oauth_state(p_state_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_mailbox_address text;
  v_department text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  DELETE FROM public.crm_zoho_oauth_states
  WHERE state_hash = p_state_hash AND expires_at > clock_timestamp()
  RETURNING actor_user_id, mailbox_address, department
  INTO v_actor_user_id, v_mailbox_address, v_department;
  DELETE FROM public.crm_zoho_oauth_states WHERE expires_at <= clock_timestamp();
  IF v_actor_user_id IS NULL OR v_mailbox_address IS NULL OR v_department IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('actor_user_id', v_actor_user_id, 'mailbox_address', v_mailbox_address, 'department', v_department);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_store_zoho_mailbox_token(
  p_actor_user_id uuid,
  p_mailbox_address text,
  p_department text,
  p_zoho_account_id text,
  p_refresh_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_address text := lower(trim(coalesce(p_mailbox_address, '')));
  v_department text := lower(trim(coalesce(p_department, '')));
  v_secret_name text;
  v_secret_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_user_id AND is_admin IS TRUE) THEN RAISE EXCEPTION 'administrator required'; END IF;
  IF NOT (
    (v_address = 'customer.care@fashionfussion.in' AND v_department = 'customer_support') OR
    (v_address = 'seller.support@fashionfussion.in' AND v_department = 'seller_support') OR
    (v_address = 'sales@fashionfussion.in' AND v_department = 'sales') OR
    (v_address = 'orders@fashionfussion.in' AND v_department = 'orders')
  ) THEN RAISE EXCEPTION 'mailbox and department do not match'; END IF;
  IF nullif(trim(p_zoho_account_id), '') IS NULL OR length(p_zoho_account_id) > 100 THEN RAISE EXCEPTION 'invalid Zoho account ID'; END IF;
  IF p_refresh_token IS NULL OR length(p_refresh_token) < 20 OR length(p_refresh_token) > 4096 THEN RAISE EXCEPTION 'invalid refresh token'; END IF;

  v_secret_name := 'crm_zoho_mailbox_' || regexp_replace(v_address, '[^a-z0-9]+', '_', 'g');
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_secret_name LIMIT 1;
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_refresh_token, v_secret_name, 'Zoho Mail OAuth refresh token for ' || v_address || '. Managed by the administrator OAuth callback.');
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_refresh_token, v_secret_name, 'Zoho Mail OAuth refresh token for ' || v_address || '. Managed by the administrator OAuth callback.');
  END IF;

  INSERT INTO private.crm_zoho_mailbox_configs (mailbox_address, department, zoho_account_id, vault_secret_name, connected_by, connected_at, updated_at)
  VALUES (v_address, v_department, trim(p_zoho_account_id), v_secret_name, p_actor_user_id, now(), now())
  ON CONFLICT (mailbox_address) DO UPDATE
    SET department = EXCLUDED.department,
        zoho_account_id = EXCLUDED.zoho_account_id,
        vault_secret_name = EXCLUDED.vault_secret_name,
        connected_by = EXCLUDED.connected_by,
        connected_at = now(),
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_get_zoho_mailbox_auth(p_department text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_address text;
  v_result jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  v_address := CASE lower(trim(coalesce(p_department, '')))
    WHEN 'customer_support' THEN 'customer.care@fashionfussion.in'
    WHEN 'seller_support' THEN 'seller.support@fashionfussion.in'
    WHEN 'sales' THEN 'sales@fashionfussion.in'
    WHEN 'marketing' THEN 'sales@fashionfussion.in'
    WHEN 'orders' THEN 'orders@fashionfussion.in'
    ELSE NULL END;
  IF v_address IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'mailbox_address', c.mailbox_address,
    'department', c.department,
    'zoho_account_id', c.zoho_account_id,
    'refresh_token', s.decrypted_secret
  )
  INTO v_result
  FROM private.crm_zoho_mailbox_configs c
  JOIN vault.decrypted_secrets s ON s.name = c.vault_secret_name
  WHERE c.mailbox_address = v_address;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_inbox_can_access_conversation(p_department text, p_inbox_address text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
  SELECT public.crm_inbox_can_access(p_department)
    OR (
      lower(trim(coalesce(p_inbox_address, ''))) IN ('sales.team@fashionfussion.in', 'sales@fashionfussion.in')
      AND (public.crm_inbox_can_access('sales') OR public.crm_inbox_can_access('marketing'))
    );
$function$;

REVOKE ALL ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_consume_zoho_oauth_state(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_store_zoho_mailbox_token(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_get_zoho_mailbox_auth(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_consume_zoho_oauth_state(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_store_zoho_mailbox_token(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_get_zoho_mailbox_auth(text) TO service_role;

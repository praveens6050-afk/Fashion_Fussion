-- Use one primary Zoho mailbox OAuth grant for all CRM department aliases.
ALTER TABLE private.crm_zoho_mailbox_configs
  DROP CONSTRAINT IF EXISTS crm_zoho_mailbox_configs_department_check;
ALTER TABLE private.crm_zoho_mailbox_configs
  ADD CONSTRAINT crm_zoho_mailbox_configs_department_check
  CHECK (department = ANY (ARRAY['administrator','customer_support','seller_support','sales','orders']::text[]));

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
  IF v_address <> 'admin@fashionfussion.in' OR v_department <> 'administrator' THEN
    RAISE EXCEPTION 'only the primary admin mailbox can be connected';
  END IF;

  DELETE FROM public.crm_zoho_oauth_states WHERE expires_at <= clock_timestamp();
  INSERT INTO public.crm_zoho_oauth_states (state_hash, actor_user_id, expires_at, mailbox_address, department)
  VALUES (p_state_hash, p_actor_user_id, p_expires_at, v_address, v_department);
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
  IF v_address <> 'admin@fashionfussion.in' OR v_department <> 'administrator' THEN
    RAISE EXCEPTION 'only the primary admin mailbox can be stored';
  END IF;
  IF nullif(trim(p_zoho_account_id), '') IS NULL OR length(p_zoho_account_id) > 100 THEN RAISE EXCEPTION 'invalid Zoho account ID'; END IF;
  IF p_refresh_token IS NULL OR length(p_refresh_token) < 20 OR length(p_refresh_token) > 4096 THEN RAISE EXCEPTION 'invalid refresh token'; END IF;

  v_secret_name := 'crm_zoho_mailbox_' || regexp_replace(v_address, '[^a-z0-9]+', '_', 'g');
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_secret_name LIMIT 1;
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_refresh_token, v_secret_name, 'Zoho Mail OAuth refresh token for the primary CRM mailbox.');
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_refresh_token, v_secret_name, 'Zoho Mail OAuth refresh token for the primary CRM mailbox.');
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
  WHERE c.mailbox_address IN ('admin@fashionfussion.in', v_address)
  ORDER BY (c.mailbox_address = 'admin@fashionfussion.in') DESC
  LIMIT 1;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_store_zoho_mailbox_token(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_get_zoho_mailbox_auth(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_store_zoho_mailbox_token(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_get_zoho_mailbox_auth(text) TO service_role;


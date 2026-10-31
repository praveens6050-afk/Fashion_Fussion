-- Allow the secured CRM OAuth flow to store department mailboxes in Vault.
-- Preserve the existing administrator mailbox connection.
BEGIN;

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
AS $function$
DECLARE
  v_address text := lower(trim(coalesce(p_mailbox_address, '')));
  v_department text := lower(trim(coalesce(p_department, '')));
  v_secret_name text;
  v_secret_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_actor_user_id AND is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'administrator required';
  END IF;
  IF NOT (
    (v_address = 'admin@fashionfussion.in' AND v_department = 'administrator') OR
    (v_address = 'customer.care@fashionfussion.in' AND v_department = 'customer_support') OR
    (v_address = 'seller.support@fashionfussion.in' AND v_department = 'seller_support') OR
    (v_address = 'sales@fashionfussion.in' AND v_department = 'sales') OR
    (v_address = 'orders@fashionfussion.in' AND v_department = 'orders')
  ) THEN
    RAISE EXCEPTION 'mailbox and department do not match';
  END IF;
  IF nullif(trim(p_zoho_account_id), '') IS NULL OR length(p_zoho_account_id) > 100 THEN
    RAISE EXCEPTION 'invalid Zoho account ID';
  END IF;
  IF p_refresh_token IS NULL OR length(p_refresh_token) < 20 OR length(p_refresh_token) > 4096 THEN
    RAISE EXCEPTION 'invalid refresh token';
  END IF;

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
$function$;
REVOKE ALL ON FUNCTION public.crm_store_zoho_mailbox_token(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_store_zoho_mailbox_token(uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_get_zoho_mailbox_auth(p_department text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_address text;
  v_result jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  v_address := CASE lower(trim(coalesce(p_department, '')))
    WHEN 'administrator' THEN 'admin@fashionfussion.in'
    WHEN 'customer_support' THEN 'customer.care@fashionfussion.in'
    WHEN 'seller_support' THEN 'seller.support@fashionfussion.in'
    WHEN 'sales' THEN 'sales@fashionfussion.in'
    WHEN 'marketing' THEN 'sales@fashionfussion.in'
    WHEN 'orders' THEN 'orders@fashionfussion.in'
    ELSE NULL
  END;
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
$function$;
REVOKE ALL ON FUNCTION public.crm_get_zoho_mailbox_auth(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_get_zoho_mailbox_auth(text) TO service_role;

COMMIT;


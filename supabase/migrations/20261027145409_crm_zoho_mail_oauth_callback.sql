-- Secure Zoho Mail OAuth callback state and Vault storage for the CRM.
CREATE TABLE public.crm_zoho_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crm_zoho_oauth_states_expires_at_idx
  ON public.crm_zoho_oauth_states (expires_at);

ALTER TABLE public.crm_zoho_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_zoho_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.crm_zoho_oauth_states TO service_role;

CREATE OR REPLACE FUNCTION public.crm_create_zoho_oauth_state(
  p_state_hash text,
  p_actor_user_id uuid,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid state hash';
  END IF;
  IF p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'invalid state expiry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_user_id AND is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'administrator required';
  END IF;

  DELETE FROM public.crm_zoho_oauth_states
  WHERE expires_at <= clock_timestamp();

  INSERT INTO public.crm_zoho_oauth_states (state_hash, actor_user_id, expires_at)
  VALUES (p_state_hash, p_actor_user_id, p_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_consume_zoho_oauth_state(p_state_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.crm_zoho_oauth_states
  WHERE state_hash = p_state_hash
    AND expires_at > clock_timestamp()
  RETURNING actor_user_id INTO v_actor_user_id;

  DELETE FROM public.crm_zoho_oauth_states
  WHERE expires_at <= clock_timestamp();

  RETURN v_actor_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_store_zoho_mail_refresh_token(
  p_actor_user_id uuid,
  p_refresh_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_user_id AND is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'administrator required';
  END IF;
  IF p_refresh_token IS NULL OR length(p_refresh_token) < 20 OR length(p_refresh_token) > 4096 THEN
    RAISE EXCEPTION 'invalid refresh token';
  END IF;

  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = 'crm_zoho_mail_refresh_token'
  LIMIT 1;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      p_refresh_token,
      'crm_zoho_mail_refresh_token',
      'CRM Zoho Mail OAuth refresh token. Managed by the administrator OAuth callback.'
    );
  ELSE
    PERFORM vault.update_secret(
      v_secret_id,
      p_refresh_token,
      'crm_zoho_mail_refresh_token',
      'CRM Zoho Mail OAuth refresh token. Managed by the administrator OAuth callback.'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_get_zoho_mail_refresh_token()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  RETURN (
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'crm_zoho_mail_refresh_token'
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_consume_zoho_oauth_state(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_store_zoho_mail_refresh_token(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_get_zoho_mail_refresh_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_consume_zoho_oauth_state(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_store_zoho_mail_refresh_token(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_get_zoho_mail_refresh_token() TO service_role;


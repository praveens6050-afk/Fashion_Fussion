-- Allow one admin OAuth grant to bootstrap the primary mailbox that owns all CRM aliases.
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
    (v_address = 'admin@fashionfussion.in' AND v_department = 'administrator') OR
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

REVOKE ALL ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_create_zoho_oauth_state(text, uuid, timestamptz, text, text) TO service_role;

-- Trigger-only SECURITY DEFINER function must not be callable as a PostgREST RPC.
REVOKE ALL ON FUNCTION public.ff_attach_signup_whatsapp_to_new_order() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ff_attach_signup_whatsapp_to_new_order() TO service_role;

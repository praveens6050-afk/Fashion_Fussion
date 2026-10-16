-- Keep raw inbound WhatsApp messages and phone numbers service-role-only.
ALTER TABLE public.whatsapp_inbound_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_inbound_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_inbound_events TO service_role;
REVOKE ALL ON SEQUENCE public.whatsapp_inbound_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_inbound_events_id_seq TO service_role;

-- This function is trigger-only; do not expose it as a PostgREST RPC.
REVOKE ALL ON FUNCTION public.stage_zoho_email_on_order_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_zoho_email_on_order_insert() TO service_role;

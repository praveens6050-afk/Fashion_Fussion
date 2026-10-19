-- Synthetic CI fixture only. Never run against production.
CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_message_id text NOT NULL,
  sender_user_id uuid
);
ALTER TABLE public.whatsapp_inbound_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.whatsapp_inbound_events TO PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.whatsapp_inbound_events_id_seq TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stage_zoho_email_on_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.stage_zoho_email_on_order_insert()
  TO PUBLIC, anon, authenticated, service_role;

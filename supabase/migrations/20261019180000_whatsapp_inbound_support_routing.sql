-- Route inbound WhatsApp conversations to the correct internal support queue.
-- Unknown senders are assigned to sales/marketing triage but remain needs_review.
ALTER TABLE public.whatsapp_inbound_events
  ADD COLUMN IF NOT EXISTS support_team text NOT NULL DEFAULT 'sales_marketing';

UPDATE public.whatsapp_inbound_events
SET support_team = CASE sender_role
  WHEN 'customer' THEN 'customer_support'
  WHEN 'seller' THEN 'seller_support'
  WHEN 'admin' THEN 'admin_operations'
  ELSE 'sales_marketing'
END
WHERE support_team IS NULL OR support_team='sales_marketing';

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.whatsapp_inbound_events'::regclass
      AND conname='whatsapp_inbound_events_support_team_check'
  ) THEN
    ALTER TABLE public.whatsapp_inbound_events
      ADD CONSTRAINT whatsapp_inbound_events_support_team_check
      CHECK (support_team IN ('customer_support','seller_support','sales_marketing','admin_operations'));
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS whatsapp_inbound_support_queue_idx
  ON public.whatsapp_inbound_events(support_team,routing_status,created_at DESC);

CREATE OR REPLACE FUNCTION public.set_whatsapp_inbound_support_team()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  NEW.support_team := CASE NEW.sender_role
    WHEN 'customer' THEN 'customer_support'
    WHEN 'seller' THEN 'seller_support'
    WHEN 'admin' THEN 'admin_operations'
    ELSE 'sales_marketing'
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_whatsapp_inbound_support_team()
  FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS trg_whatsapp_inbound_support_team
  ON public.whatsapp_inbound_events;
CREATE TRIGGER trg_whatsapp_inbound_support_team
  BEFORE INSERT OR UPDATE OF sender_role,support_team
  ON public.whatsapp_inbound_events
  FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_inbound_support_team();

COMMENT ON COLUMN public.whatsapp_inbound_events.support_team IS
  'Server-derived internal queue. Unknown senders route to sales_marketing triage but remain needs_review until identity is verified.';

-- Document why sensitive internal tables intentionally have RLS enabled with no client policies.
-- No grants or policies are changed here: browser access remains denied; trusted server-side
-- functions and service-role workflows are the only intended access paths.
COMMENT ON TABLE public.auth_login_otp_challenges IS
  'Sensitive authentication challenge storage. RLS with no client policies is intentional; use trusted server-side authentication/rate-limit functions only.';
COMMENT ON TABLE public.phone_otp_challenges IS
  'Sensitive phone OTP challenge storage. RLS with no client policies is intentional; never read or mutate challenge rows from browser clients.';
COMMENT ON TABLE public.whatsapp_consent_events IS
  'Immutable WhatsApp consent audit events. RLS with no client policies is intentional; access through trusted consent workflows only.';
COMMENT ON TABLE public.whatsapp_contact_consents IS
  'WhatsApp contact consent ledger. RLS with no client policies is intentional; access through trusted consent and notification functions only.';
COMMENT ON TABLE public.whatsapp_delivery_status_events IS
  'Provider delivery receipt audit log. RLS with no client policies is intentional; ingest signed provider receipts through the server-side webhook.';
COMMENT ON TABLE public.whatsapp_inbound_events IS
  'Private WhatsApp inbound webhook event store. RLS with no client policies is intentional; ingest signed provider events through the server-side webhook.';
COMMENT ON TABLE public.whatsapp_order_consents IS
  'Order-notification WhatsApp consent records. RLS with no client policies is intentional; access through trusted order notification workflows only.';
COMMENT ON TABLE public.whatsapp_order_notification_outbox IS
  'Private staged WhatsApp order notification outbox. RLS with no client policies is intentional; dispatch only through approved server-side workers.';
COMMENT ON TABLE public.zoho_order_email_outbox IS
  'Private staged transactional order email outbox. RLS with no client policies is intentional; process only through approved server-side Zoho workflows.';

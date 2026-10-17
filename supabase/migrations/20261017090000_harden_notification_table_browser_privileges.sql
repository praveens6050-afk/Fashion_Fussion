-- Keep notification outboxes, consent ledgers, inbound webhooks, and OTP challenges
-- server-only. RLS without policies blocks row access today; explicit ACL revocation
-- is defense in depth and prevents future policy changes from silently exposing them.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
  public.whatsapp_contact_consents,
  public.whatsapp_consent_events,
  public.whatsapp_order_consents,
  public.whatsapp_order_notification_outbox,
  public.whatsapp_delivery_status_events,
  public.whatsapp_inbound_events,
  public.zoho_order_email_outbox,
  public.payment_recovery_notifications,
  public.phone_otp_challenges,
  public.auth_login_otp_challenges
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.whatsapp_contact_consents,
  public.whatsapp_consent_events,
  public.whatsapp_order_consents,
  public.whatsapp_order_notification_outbox,
  public.whatsapp_delivery_status_events,
  public.whatsapp_inbound_events,
  public.zoho_order_email_outbox,
  public.payment_recovery_notifications,
  public.phone_otp_challenges,
  public.auth_login_otp_challenges
TO service_role;

COMMIT;

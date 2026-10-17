-- Disposable PostgreSQL fixture only. Never run this file against Supabase production.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.whatsapp_contact_consents(id bigint);
CREATE TABLE public.whatsapp_consent_events(id bigint);
CREATE TABLE public.whatsapp_order_consents(id bigint);
CREATE TABLE public.whatsapp_order_notification_outbox(id bigint);
CREATE TABLE public.whatsapp_delivery_status_events(id bigint);
CREATE TABLE public.whatsapp_inbound_events(id bigint);
CREATE TABLE public.zoho_order_email_outbox(id bigint);
CREATE TABLE public.payment_recovery_notifications(id bigint);
CREATE TABLE public.phone_otp_challenges(id bigint);
CREATE TABLE public.auth_login_otp_challenges(id bigint);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO PUBLIC, anon, authenticated, service_role;

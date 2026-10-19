-- Isolated CI-only PostgreSQL fixture, never run against Fashion Fussion production.
-- This creates ONLY synthetic tables/users inside the ephemeral GitHub Actions DB.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $roles$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path TO ''
AS $auth$
 SELECT NULLIF(pg_catalog.current_setting('ff.test_uid',true),'')::uuid
$auth$;

CREATE TABLE public.orders (
 id bigint PRIMARY KEY,
 user_id uuid,
 status text NOT NULL,
 fulfillment_status text NOT NULL DEFAULT 'ordered',
 payment_method text NOT NULL,
 payment_verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 fulfillment_updated_at timestamptz,
 customer_phone text,
 customer_name text,
 display_order_id text
);

CREATE TABLE public.order_shipments (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES public.orders(id),
 direction text NOT NULL,
 awb_code text
);

CREATE TABLE public.whatsapp_order_consents (
 order_id bigint PRIMARY KEY REFERENCES public.orders(id),
 user_id uuid NOT NULL,
 phone_e164 text NOT NULL,
 source text NOT NULL DEFAULT 'checkout_checkbox',
 consented_at timestamptz NOT NULL,
 revoked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_contact_consents (
 phone_e164 text NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('transactional','marketing')),
 status text NOT NULL CHECK (status IN ('opted_in','opted_out')),
 source text NOT NULL DEFAULT 'checkout_checkbox',
 proof_reference text NOT NULL DEFAULT 'synthetic-test',
 consented_at timestamptz,
 revoked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (phone_e164,purpose)
);

CREATE TABLE public.whatsapp_order_notification_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES public.orders(id),
 event_type text NOT NULL,
 status text NOT NULL DEFAULT 'pending_review',
 attempt_count integer NOT NULL DEFAULT 0,
 template_name text NOT NULL DEFAULT 'order_status_update',
 provider_message_id text,
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT whatsapp_order_notification_once_per_order_event UNIQUE(order_id,event_type)
);

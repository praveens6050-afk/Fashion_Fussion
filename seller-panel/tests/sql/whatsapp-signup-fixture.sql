-- Isolated signup-consent test support; synthetic rows only.
-- Loaded after whatsapp-fixture.sql and before the migration under test.
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  phone text,
  phone_verified_at timestamptz,
  phone_verification_method text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.phone_otp_challenges (
  id uuid PRIMARY KEY,
  phone_e164 text NOT NULL,
  email text NOT NULL,
  audience text NOT NULL,
  otp_hash text NOT NULL DEFAULT 'synthetic-hash',
  request_ip_hash text,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  consumed_at timestamptz
);

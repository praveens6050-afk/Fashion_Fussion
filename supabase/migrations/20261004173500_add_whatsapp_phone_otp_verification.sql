create table if not exists public.phone_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text not null,
  audience text not null check (audience in ('customer','retailer','seller')),
  otp_hash text not null,
  request_ip_hash text,
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists phone_otp_challenges_phone_created_idx
  on public.phone_otp_challenges (phone_e164, created_at desc);
create index if not exists phone_otp_challenges_ip_created_idx
  on public.phone_otp_challenges (request_ip_hash, created_at desc)
  where request_ip_hash is not null;
create index if not exists phone_otp_challenges_email_created_idx
  on public.phone_otp_challenges (lower(email), created_at desc);

alter table public.phone_otp_challenges enable row level security;

alter table public.profiles
  add column if not exists phone_verified_at timestamptz,
  add column if not exists phone_verification_method text;

alter table public.seller_profiles
  add column if not exists phone_verified_at timestamptz,
  add column if not exists phone_verification_method text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_phone_verification_method_check'
  ) then
    alter table public.profiles
      add constraint profiles_phone_verification_method_check
      check (phone_verification_method is null or phone_verification_method in ('whatsapp'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'seller_profiles_phone_verification_method_check'
  ) then
    alter table public.seller_profiles
      add constraint seller_profiles_phone_verification_method_check
      check (phone_verification_method is null or phone_verification_method in ('whatsapp'));
  end if;
end $$;

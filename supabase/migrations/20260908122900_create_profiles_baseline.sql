-- The repository's checked-in migration history assumes profiles already exists.
-- Recreate the minimal foundational contract used by the earliest policy migrations.
-- Later migrations add the remaining profile fields and constraints.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_admin boolean not null default false,
  account_type text not null default 'retail'
    check (account_type in ('retail', 'business')),
  phone_verified_at timestamptz,
  phone_verification_method text
    check (phone_verification_method is null or phone_verification_method = 'whatsapp')
);

alter table public.profiles enable row level security;

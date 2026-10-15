create table if not exists public.whatsapp_contact_consents (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null check (purpose in ('transactional','marketing')),
  status text not null check (status in ('opted_in','opted_out')),
  source text not null check (length(btrim(source)) between 3 and 80),
  proof_reference text not null check (length(btrim(proof_reference)) between 3 and 255),
  consented_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_contact_consents_state_check check (
    (status = 'opted_in' and consented_at is not null and revoked_at is null)
    or (status = 'opted_out' and revoked_at is not null)
  ),
  constraint whatsapp_contact_consents_phone_purpose_unique unique(phone_e164,purpose)
);
alter table public.whatsapp_contact_consents enable row level security;
revoke all on table public.whatsapp_contact_consents from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_contact_consents to service_role;
comment on table public.whatsapp_contact_consents is 'Server-only authoritative WhatsApp consent ledger. No browser write or read policies. A WhatsApp OTP is not marketing opt-in. No automated sending is enabled by this migration.';

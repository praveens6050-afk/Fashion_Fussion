alter table public.whatsapp_contact_consents
  add column if not exists last_event_at timestamptz,
  add column if not exists last_event_id text;
create table if not exists public.whatsapp_consent_events (
  id bigint generated always as identity primary key,
  external_message_id text not null unique,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null check (purpose in ('marketing','transactional')),
  status text not null check (status in ('opted_in','opted_out')),
  event_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_consent_events enable row level security;
revoke all on table public.whatsapp_consent_events from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_consent_events to service_role;
grant usage,select on sequence public.whatsapp_consent_events_id_seq to service_role;
create or replace function public.record_whatsapp_consent_command(
  p_phone_e164 text,
  p_external_message_id text,
  p_status text,
  p_event_at timestamptz
) returns void
language plpgsql
security invoker
set search_path = public,pg_temp
as $$
declare v_added integer;
begin
  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or p_external_message_id is null or length(p_external_message_id) not between 5 and 255
     or p_status not in ('opted_in','opted_out')
     or p_event_at is null or p_event_at > now() + interval '5 minutes'
     or p_event_at < timestamp with time zone '2020-01-01'
  then raise exception 'Invalid WhatsApp consent event';
  end if;
  insert into public.whatsapp_consent_events
    (external_message_id,phone_e164,purpose,status,event_at)
  values
    (p_external_message_id,p_phone_e164,'marketing',p_status,p_event_at)
  on conflict (external_message_id) do nothing;
  get diagnostics v_added = row_count;
  if v_added = 0 then return; end if;

  insert into public.whatsapp_contact_consents as current_consent
    (phone_e164,purpose,status,source,proof_reference,consented_at,revoked_at,updated_at,last_event_at,last_event_id)
  values
    (p_phone_e164,'marketing',p_status,'whatsapp_keyword',p_external_message_id,
     case when p_status = 'opted_in' then p_event_at else null end,
     case when p_status = 'opted_out' then p_event_at else null end,
     now(),p_event_at,p_external_message_id)
  on conflict (phone_e164,purpose)
  do update set
    status=excluded.status,
    source=excluded.source,
    proof_reference=excluded.proof_reference,
    consented_at=excluded.consented_at,
    revoked_at=excluded.revoked_at,
    updated_at=now(),
    last_event_at=excluded.last_event_at,
    last_event_id=excluded.last_event_id
  where current_consent.last_event_at is null
     or current_consent.last_event_at < excluded.last_event_at
     or (current_consent.last_event_at = excluded.last_event_at
         and current_consent.status = 'opted_in' and excluded.status = 'opted_out');
end;
$$;
revoke all on function public.record_whatsapp_consent_command(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_whatsapp_consent_command(text,text,text,timestamptz) to service_role;
comment on function public.record_whatsapp_consent_command(text,text,text,timestamptz) is
  'Atomic signed Meta WhatsApp JOIN/STOP consent event logger; STOP wins timestamp ties and stale events cannot revive opt-in.';

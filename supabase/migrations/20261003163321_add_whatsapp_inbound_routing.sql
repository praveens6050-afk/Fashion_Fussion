create table if not exists public.whatsapp_inbound_events (
  id bigint generated always as identity primary key,
  external_message_id text not null unique,
  sender_phone text not null,
  sender_role text not null check (sender_role in ('admin','seller','customer','unclassified')),
  sender_user_id uuid null references auth.users(id) on delete set null,
  classification_source text not null,
  routing_status text not null default 'classified' check (routing_status in ('classified','needs_review')),
  message_type text null,
  message_text text null,
  phone_number_id text null,
  business_phone text null,
  meta_timestamp timestamptz null,
  raw_message jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_inbound_events_sender_idx
  on public.whatsapp_inbound_events (sender_phone, created_at desc);

create index if not exists whatsapp_inbound_events_role_idx
  on public.whatsapp_inbound_events (sender_role, created_at desc);

alter table public.whatsapp_inbound_events enable row level security;

create or replace function public.ingest_whatsapp_inbound_event(
  p_external_message_id text,
  p_sender_phone text,
  p_message_type text,
  p_message_text text,
  p_phone_number_id text,
  p_business_phone text,
  p_meta_timestamp timestamptz,
  p_raw_message jsonb
)
returns public.whatsapp_inbound_events
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_phone text := regexp_replace(coalesce(p_sender_phone,''),'[^0-9]','','g');
  v_user uuid;
  v_role text := 'unclassified';
  v_source text := 'none';
  v_row public.whatsapp_inbound_events;
begin
  if coalesce(btrim(p_external_message_id),'') = '' then
    raise exception 'WhatsApp external message id is required';
  end if;
  if v_phone = '' then
    raise exception 'WhatsApp sender phone is required';
  end if;

  select e.* into v_row
  from public.whatsapp_inbound_events e
  where e.external_message_id = p_external_message_id
  limit 1;
  if found then
    return v_row;
  end if;

  select p.id into v_user
  from public.profiles p
  where p.is_admin is true
    and (
      regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') = v_phone
      or (length(v_phone)=12 and left(v_phone,2)='91' and regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=right(v_phone,10))
      or (length(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'))=12 and left(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),2)='91' and right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),10)=v_phone)
    )
  limit 1;

  if v_user is not null then
    v_role := 'admin';
    v_source := 'profiles.is_admin';
  else
    select sp.user_id into v_user
    from public.seller_profiles sp
    where sp.status = 'active'
      and (
        regexp_replace(coalesce(sp.phone,''),'[^0-9]','','g') = v_phone
        or (length(v_phone)=12 and left(v_phone,2)='91' and regexp_replace(coalesce(sp.phone,''),'[^0-9]','','g')=right(v_phone,10))
        or (length(regexp_replace(coalesce(sp.phone,''),'[^0-9]','','g'))=12 and left(regexp_replace(coalesce(sp.phone,''),'[^0-9]','','g'),2)='91' and right(regexp_replace(coalesce(sp.phone,''),'[^0-9]','','g'),10)=v_phone)
      )
    limit 1;

    if v_user is not null then
      v_role := 'seller';
      v_source := 'seller_profiles.active';
    else
      select p.id into v_user
      from public.profiles p
      where (
        regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') = v_phone
        or (length(v_phone)=12 and left(v_phone,2)='91' and regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=right(v_phone,10))
        or (length(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'))=12 and left(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),2)='91' and right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),10)=v_phone)
      )
      limit 1;

      if v_user is not null then
        v_role := 'customer';
        v_source := 'profiles.phone';
      else
        v_source := 'none';
      end if;
    end if;
  end if;

  insert into public.whatsapp_inbound_events (
    external_message_id,
    sender_phone,
    sender_role,
    sender_user_id,
    classification_source,
    routing_status,
    message_type,
    message_text,
    phone_number_id,
    business_phone,
    meta_timestamp,
    raw_message
  ) values (
    p_external_message_id,
    v_phone,
    v_role,
    v_user,
    v_source,
    case when v_role='unclassified' then 'needs_review' else 'classified' end,
    nullif(p_message_type,''),
    p_message_text,
    nullif(p_phone_number_id,''),
    nullif(p_business_phone,''),
    p_meta_timestamp,
    coalesce(p_raw_message,'{}'::jsonb)
  )
  on conflict (external_message_id) do update
    set external_message_id = excluded.external_message_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.ingest_whatsapp_inbound_event(text,text,text,text,text,text,timestamptz,jsonb) from public;
revoke all on function public.ingest_whatsapp_inbound_event(text,text,text,text,text,text,timestamptz,jsonb) from anon;
revoke all on function public.ingest_whatsapp_inbound_event(text,text,text,text,text,text,timestamptz,jsonb) from authenticated;
grant execute on function public.ingest_whatsapp_inbound_event(text,text,text,text,text,text,timestamptz,jsonb) to service_role;

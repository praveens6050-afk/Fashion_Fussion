create table if not exists public.auth_login_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check (audience in ('customer','seller')),
  email text not null,
  phone_e164 text,
  otp_hash text not null,
  request_ip_hash text,
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  verified_at timestamptz,
  consumed_at timestamptz,
  email_sent_at timestamptz,
  whatsapp_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_login_otp_user_created_idx on public.auth_login_otp_challenges(user_id,created_at desc);
create index if not exists auth_login_otp_ip_created_idx on public.auth_login_otp_challenges(request_ip_hash,created_at desc) where request_ip_hash is not null;
create index if not exists auth_login_otp_email_created_idx on public.auth_login_otp_challenges(lower(email),created_at desc);
alter table public.auth_login_otp_challenges enable row level security;

create or replace function public.resolve_auth_login_identity(p_audience text, p_identifier text)
returns table(user_id uuid,email text,phone_e164 text,phone_verified boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_identifier text := btrim(coalesce(p_identifier,''));
  v_digits text := regexp_replace(coalesce(p_identifier,''), '\D', '', 'g');
  v_is_email boolean := position('@' in v_identifier) > 0;
begin
  if p_audience = 'seller' then
    return query
    select u.id,
           lower(u.email),
           case when sp.phone is null then null else '+91' || right(regexp_replace(sp.phone,'\D','','g'),10) end,
           (sp.phone_verified_at is not null)
    from public.seller_profiles sp
    join auth.users u on u.id = sp.user_id
    where sp.status = 'active'
      and (
        (v_is_email and lower(u.email) = lower(v_identifier))
        or
        (not v_is_email and sp.phone_verified_at is not null and right(regexp_replace(coalesce(sp.phone,''),'\D','','g'),10) = right(v_digits,10) and length(v_digits) in (10,12))
      )
    limit 1;
  elsif p_audience = 'customer' then
    return query
    select u.id,
           lower(u.email),
           case when p.phone is null then null else '+91' || right(regexp_replace(p.phone,'\D','','g'),10) end,
           (p.phone_verified_at is not null)
    from public.profiles p
    join auth.users u on u.id = p.id
    where coalesce(p.is_admin,false) = false
      and (
        (v_is_email and lower(u.email) = lower(v_identifier))
        or
        (not v_is_email and p.phone_verified_at is not null and right(regexp_replace(coalesce(p.phone,''),'\D','','g'),10) = right(v_digits,10) and length(v_digits) in (10,12))
      )
    limit 1;
  end if;
end;
$$;
revoke all on function public.resolve_auth_login_identity(text,text) from public, anon, authenticated;
grant execute on function public.resolve_auth_login_identity(text,text) to service_role;

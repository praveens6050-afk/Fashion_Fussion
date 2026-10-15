create or replace function public.resolve_verified_seller_login_email(p_phone text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_count integer;
begin
  select count(*), min(u.email)
    into v_count, v_email
  from public.seller_profiles sp
  join auth.users u on u.id = sp.user_id
  where regexp_replace(coalesce(sp.phone,''), '\D', '', 'g') = regexp_replace(coalesce(p_phone,''), '\D', '', 'g')
    and sp.phone_verified_at is not null
    and sp.status = 'active';

  if v_count <> 1 then
    return null;
  end if;
  return lower(v_email);
end;
$$;
revoke all on function public.resolve_verified_seller_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_verified_seller_login_email(text) to service_role;

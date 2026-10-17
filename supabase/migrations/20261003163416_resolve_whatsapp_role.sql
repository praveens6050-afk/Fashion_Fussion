create or replace function public.resolve_whatsapp_role(input_phone text)
returns table(role text, user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := regexp_replace(coalesce(input_phone, ''), '\D', '', 'g');
  local10 text := right(regexp_replace(coalesce(input_phone, ''), '\D', '', 'g'), 10);
begin
  if normalized = '' then
    role := 'unknown';
    user_id := null;
    return next;
    return;
  end if;

  select 'admin', p.id
    into role, user_id
  from public.profiles p
  where p.is_admin = true
    and (
      regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = normalized
      or (length(local10) = 10 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = local10)
    )
  limit 1;
  if found then return next; return; end if;

  select 'seller', s.user_id
    into role, user_id
  from public.seller_profiles s
  where (
      regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = normalized
      or (length(local10) = 10 and right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 10) = local10)
    )
  limit 1;
  if found then return next; return; end if;

  select 'customer', p.id
    into role, user_id
  from public.profiles p
  where (
      regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = normalized
      or (length(local10) = 10 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = local10)
    )
  limit 1;
  if found then return next; return; end if;

  role := 'customer';
  user_id := null;
  return next;
end;
$$;

revoke all on function public.resolve_whatsapp_role(text) from public;
revoke all on function public.resolve_whatsapp_role(text) from anon;
revoke all on function public.resolve_whatsapp_role(text) from authenticated;
grant execute on function public.resolve_whatsapp_role(text) to service_role;

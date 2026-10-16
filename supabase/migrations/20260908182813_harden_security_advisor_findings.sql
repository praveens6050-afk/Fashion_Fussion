-- The original production schema may provide handle_new_user(), but the
-- checked-in migration history does not include its creation. Keep a clean
-- replay deterministic: harden the function only when it exists. This does not
-- create or replace signup behavior and does not weaken any existing function.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
    grant execute on function public.handle_new_user() to postgres, service_role;
  end if;
end
$$;

drop policy if exists "promotion_reservations_deny_clients" on public.promotion_reservations;
create policy "promotion_reservations_deny_clients"
on public.promotion_reservations
for all
to anon, authenticated
using (false)
with check (false);

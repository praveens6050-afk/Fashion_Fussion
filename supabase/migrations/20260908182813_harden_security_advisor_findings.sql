revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;

drop policy if exists "promotion_reservations_deny_clients" on public.promotion_reservations;
create policy "promotion_reservations_deny_clients"
on public.promotion_reservations
for all
to anon, authenticated
using (false)
with check (false);
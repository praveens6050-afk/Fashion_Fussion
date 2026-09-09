drop policy if exists "Users can update their own profile" on public.profiles;

create or replace function public.protect_profile_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.is_admin := old.is_admin;
  return new;
end;
$$;

revoke all on function public.protect_profile_admin_flag() from public, anon, authenticated;

drop trigger if exists protect_profile_admin_flag_before_update on public.profiles;
create trigger protect_profile_admin_flag_before_update
before update on public.profiles
for each row execute function public.protect_profile_admin_flag();

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop function if exists public.current_user_is_admin();

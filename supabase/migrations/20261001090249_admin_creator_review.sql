create or replace function public.admin_list_creators(p_status text default null)
returns table(user_id uuid,display_name text,handle text,social_handle text,status text,commission_rate numeric,created_at timestamptz)
language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'Administrator access required'; end if;
 return query select c.user_id,c.display_name,c.handle,c.social_handle,c.status,c.commission_rate,c.created_at from public.creator_profiles c where p_status is null or c.status=lower(trim(p_status)) order by case c.status when 'pending' then 0 when 'approved' then 1 else 2 end,c.created_at desc;
end $$;
revoke all on function public.admin_list_creators(text) from public,anon;
grant execute on function public.admin_list_creators(text) to authenticated,service_role;

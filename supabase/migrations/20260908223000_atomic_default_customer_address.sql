create or replace function public.set_default_customer_address(p_address_id bigint)
returns void language plpgsql security definer set search_path=''
as $$declare uid uuid:=auth.uid();begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.customer_addresses where id=p_address_id and user_id=uid) then raise exception 'Address not found'; end if;
  update public.customer_addresses set is_default=false,updated_at=now() where user_id=uid and is_default=true and id<>p_address_id;
  update public.customer_addresses set is_default=true,updated_at=now() where id=p_address_id and user_id=uid;
end$$;
revoke execute on function public.set_default_customer_address(bigint) from public,anon;
grant execute on function public.set_default_customer_address(bigint) to authenticated;
notify pgrst,'reload schema';

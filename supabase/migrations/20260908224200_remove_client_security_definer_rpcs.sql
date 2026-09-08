drop function if exists public.admin_product_costs();
drop function if exists public.complete_cod_order(bigint);
drop function if exists public.cancel_cod_order(bigint);

create or replace function public.complete_cod_order_service(p_order_id bigint,p_admin_id uuid)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;begin
  if not exists(select 1 from public.profiles p where p.id=p_admin_id and p.is_admin=true) then raise exception 'Admin access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if o.status='cod_collected' then return; end if;
  if o.status<>'cod_pending' then raise exception 'COD order is not pending collection'; end if;
  if o.fulfillment_status<>'delivered' then raise exception 'Mark the order delivered before confirming COD collection'; end if;
  perform public.finalize_order_promotions(o.id,o.user_id);
  update public.orders set status='cod_collected',payment_verified_at=now(),payment_source='cod_collection' where id=o.id;
end$$;
revoke execute on function public.complete_cod_order_service(bigint,uuid) from public,anon,authenticated;
grant execute on function public.complete_cod_order_service(bigint,uuid) to service_role;

create or replace function public.cancel_cod_order_service(p_order_id bigint,p_admin_id uuid)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;begin
  if not exists(select 1 from public.profiles p where p.id=p_admin_id and p.is_admin=true) then raise exception 'Admin access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if o.status='cod_cancelled' then return; end if;
  if o.status<>'cod_pending' then raise exception 'Only pending COD orders can be cancelled'; end if;
  perform public.release_order_promotions(o.id,o.user_id);
  update public.orders set status='cod_cancelled',fulfillment_status='cancelled',fulfillment_updated_at=now(),payment_source='cod_cancelled' where id=o.id;
end$$;
revoke execute on function public.cancel_cod_order_service(bigint,uuid) from public,anon,authenticated;
grant execute on function public.cancel_cod_order_service(bigint,uuid) to service_role;

create or replace function public.set_default_customer_address(p_address_id bigint)
returns void language plpgsql security invoker set search_path=''
as $$declare uid uuid:=auth.uid();begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.customer_addresses where id=p_address_id and user_id=uid) then raise exception 'Address not found'; end if;
  update public.customer_addresses set is_default=false,updated_at=now() where user_id=uid and is_default=true and id<>p_address_id;
  update public.customer_addresses set is_default=true,updated_at=now() where id=p_address_id and user_id=uid;
end$$;
revoke execute on function public.set_default_customer_address(bigint) from public,anon;
grant execute on function public.set_default_customer_address(bigint) to authenticated;
notify pgrst,'reload schema';

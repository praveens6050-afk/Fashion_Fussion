create or replace function public.complete_cod_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=''
as $$declare o public.orders%rowtype;begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true) then raise exception 'Admin access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if o.status='cod_collected' then return; end if;
  if o.status<>'cod_pending' then raise exception 'COD order is not pending collection'; end if;
  if o.fulfillment_status<>'delivered' then raise exception 'Mark the order delivered before confirming COD collection'; end if;
  perform public.finalize_order_promotions(o.id,o.user_id);
  update public.orders set status='cod_collected',payment_verified_at=now(),payment_source='cod_collection' where id=o.id;
end$$;
revoke execute on function public.complete_cod_order(bigint) from public,anon;
grant execute on function public.complete_cod_order(bigint) to authenticated;
notify pgrst,'reload schema';

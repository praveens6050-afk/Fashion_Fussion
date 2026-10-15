-- Seller-scoped creator commerce analytics. Ledger remains authoritative; no payout mutation is exposed.
create or replace function public.get_seller_creator_analytics()
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_orders bigint:=0; v_gmv numeric:=0; v_commission numeric:=0; v_creators bigint:=0; v_rows jsonb:='[]'::jsonb;
begin
 if v_uid is null or not exists(select 1 from public.seller_profiles where user_id=v_uid) then raise exception 'Seller access required'; end if;
 with seller_products as (select distinct approved_product_id product_id from public.seller_product_submissions where seller_id=v_uid and approved_product_id is not null and lower(coalesce(status,''))='approved'), scoped as (select l.* from public.creator_commission_ledger l join seller_products sp on sp.product_id=l.product_id)
 select count(distinct order_id),coalesce(sum(gross_attributed_amount),0),coalesce(sum(commission_amount) filter(where status<>'void'),0),count(distinct creator_id) into v_orders,v_gmv,v_commission,v_creators from scoped;
 with seller_products as (select distinct approved_product_id product_id from public.seller_product_submissions where seller_id=v_uid and approved_product_id is not null and lower(coalesce(status,''))='approved'), grouped as (
  select l.creator_id,cp.display_name,cp.handle,count(distinct l.order_id) orders,round(coalesce(sum(l.gross_attributed_amount),0),2) attributed_value,round(coalesce(sum(l.commission_amount) filter(where l.status<>'void'),0),2) commission,max(l.created_at) last_at
  from public.creator_commission_ledger l join seller_products sp on sp.product_id=l.product_id join public.creator_profiles cp on cp.user_id=l.creator_id group by l.creator_id,cp.display_name,cp.handle order by attributed_value desc,last_at desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('creator_id',creator_id,'display_name',display_name,'handle',handle,'orders',orders,'attributed_value',attributed_value,'commission',commission,'last_at',last_at) order by attributed_value desc,last_at desc),'[]'::jsonb) into v_rows from grouped;
 return jsonb_build_object('orders',v_orders,'attributed_value',round(v_gmv,2),'creator_commission',round(v_commission,2),'active_creators',v_creators,'creators',v_rows);
end $$;
revoke all on function public.get_seller_creator_analytics() from public,anon,authenticated;
grant execute on function public.get_seller_creator_analytics() to authenticated,service_role;

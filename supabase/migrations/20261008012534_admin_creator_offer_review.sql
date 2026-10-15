-- Admin-controlled offer decisions. Seller RLS cannot approve its own offer.
create or replace function public.admin_review_seller_creator_offer(p_offer_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_status text:=lower(trim(coalesce(p_decision,''))); v_offer public.seller_creator_offers%rowtype;
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if;
 if v_status not in ('approved','rejected') then raise exception 'Invalid offer decision'; end if;
 select * into v_offer from public.seller_creator_offers where id=p_offer_id for update;
 if v_offer.id is null then raise exception 'Offer not found'; end if;
 if v_offer.status<>'submitted' then raise exception 'Only submitted offers may be reviewed'; end if;
 if not exists(select 1 from public.seller_product_submissions s where s.seller_id=v_offer.seller_id and s.approved_product_id=v_offer.product_id and lower(s.status)='approved') then raise exception 'Product is no longer approved for this seller'; end if;
 update public.seller_creator_offers set status=v_status,updated_at=now() where id=p_offer_id;
 return jsonb_build_object('id',p_offer_id,'status',v_status);
end $$;
revoke all on function public.admin_review_seller_creator_offer(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_review_seller_creator_offer(uuid,text) to authenticated,service_role;
create or replace function public.admin_list_seller_creator_offers()
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_result jsonb;
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'seller_id',o.seller_id,'product_id',o.product_id,'proposed_rate',o.proposed_rate,'status',o.status,'created_at',o.created_at) order by o.created_at desc),'[]'::jsonb) into v_result from (select * from public.seller_creator_offers order by created_at desc limit 100) o;
 return v_result;
end $$;
revoke all on function public.admin_list_seller_creator_offers() from public,anon,authenticated;
grant execute on function public.admin_list_seller_creator_offers() to authenticated,service_role;

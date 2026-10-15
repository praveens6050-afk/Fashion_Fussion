-- Creator product discovery respects seller opt-in and approved creator status.
create or replace function public.get_creator_matchable_products(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_result jsonb;
begin
 if v_uid is null or not exists(select 1 from public.creator_profiles where user_id=v_uid and status='approved') then raise exception 'Approved creator access required'; end if;
 select coalesce(jsonb_agg(x.obj order by x.relevance_boost desc,x.product_id desc),'[]'::jsonb) into v_result
 from (
  select p.id product_id,coalesce(s.relevance_boost,0) relevance_boost,
   jsonb_build_object('id',p.id,'name',p.name,'price',p.price,'category',p.category,'image',p.image,'verified_seller',coalesce(s.verified_seller,false),'value_signal',coalesce(s.value_signal,'standard'),'visibility_boost_active',coalesce(s.visibility_boost_active,false)) obj
  from public.products p
  join lateral (select distinct on (ss.approved_product_id) ss.seller_id from public.seller_product_submissions ss where ss.approved_product_id=p.id and lower(coalesce(ss.status,''))='approved' order by ss.approved_product_id,ss.updated_at desc,ss.id desc) m on true
  join public.seller_growth_programs g on g.seller_id=m.seller_id and g.creator_matching_enabled=true and g.launchpad_status in ('enrolled','active')
  left join public.get_marketplace_product_signals() s on s.product_id=p.id
  where p.is_active=true order by coalesce(s.relevance_boost,0) desc,p.id desc limit greatest(1,least(coalesce(p_limit,100),200))
 ) x;
 return v_result;
end $$;
revoke all on function public.get_creator_matchable_products(integer) from public,anon,authenticated;
grant execute on function public.get_creator_matchable_products(integer) to authenticated,service_role;

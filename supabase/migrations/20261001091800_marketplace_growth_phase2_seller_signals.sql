-- Fashion Fussion marketplace growth Phase 2: seller trust, value, visibility and FastPay readiness signals.
create or replace function public.get_marketplace_product_signals()
returns table(product_id bigint,seller_id uuid,verified_seller boolean,visibility_boost_active boolean,value_signal text,category_reference_price numeric,relevance_boost integer)
language sql stable security definer set search_path='pg_catalog','public' as $$
with mapped as (
  select distinct on (s.approved_product_id) s.approved_product_id product_id,s.seller_id
  from public.seller_product_submissions s
  where s.approved_product_id is not null and lower(coalesce(s.status,''))='approved'
  order by s.approved_product_id,s.updated_at desc,s.id desc
), medians as (
  select category,percentile_cont(0.5) within group(order by price)::numeric median_price,count(*) peer_count
  from public.products where is_active=true and price>=0 group by category
)
select p.id,m.seller_id,
  (m.seller_id is not null and sp.status='active' and sc.verification_status='verified' and pay.verification_status='verified') verified_seller,
  (g.visibility_boost_ends_at>now() and g.launchpad_status in ('enrolled','active')) visibility_boost_active,
  case when md.peer_count>=3 and p.price<=md.median_price*0.85 then 'great_value' when md.peer_count>=3 and p.price<=md.median_price then 'competitive' else 'standard' end value_signal,
  case when md.peer_count>=3 then round(md.median_price,2) else null end category_reference_price,
  ((case when g.visibility_boost_ends_at>now() and g.launchpad_status in ('enrolled','active') then 20 else 0 end)+(case when m.seller_id is not null and sp.status='active' and sc.verification_status='verified' and pay.verification_status='verified' then 8 else 0 end))::integer relevance_boost
from public.products p
left join mapped m on m.product_id=p.id
left join public.seller_profiles sp on sp.user_id=m.seller_id
left join public.seller_compliance_profiles sc on sc.seller_id=m.seller_id
left join public.seller_payout_profiles pay on pay.seller_id=m.seller_id
left join public.seller_growth_programs g on g.seller_id=m.seller_id
left join medians md on md.category is not distinct from p.category
where p.is_active=true;
$$;
revoke all on function public.get_marketplace_product_signals() from public;
grant execute on function public.get_marketplace_product_signals() to anon,authenticated,service_role;

create or replace function public.evaluate_seller_fastpay_eligibility(p_seller_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_admin boolean:=false; v_kyc boolean:=false; v_payout boolean:=false; v_delivered bigint:=0; v_returns bigint:=0; v_return_rate numeric:=0; v_eligible boolean:=false; v_current text;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 select exists(select 1 from public.profiles where id=v_uid and is_admin=true) into v_admin;
 if v_uid<>p_seller_id and not v_admin then raise exception 'Seller access required'; end if;
 select exists(select 1 from public.seller_compliance_profiles where seller_id=p_seller_id and verification_status='verified') into v_kyc;
 select exists(select 1 from public.seller_payout_profiles where seller_id=p_seller_id and verification_status='verified') into v_payout;
 with seller_products as (select distinct approved_product_id product_id from public.seller_product_submissions where seller_id=p_seller_id and approved_product_id is not null and lower(coalesce(status,''))='approved'), seller_orders as (select distinct o.id from public.orders o where exists(select 1 from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) item join seller_products sp on sp.product_id=nullif(item->>'id','')::bigint))
 select count(distinct so.id) into v_delivered from seller_orders so where exists(select 1 from public.order_shipments sh where sh.order_id=so.id and lower(coalesce(sh.direction,'forward')) not in ('return','reverse') and (lower(coalesce(sh.status,''))='delivered' or lower(coalesce(sh.provider_status,''))='delivered'));
 with seller_products as (select distinct approved_product_id product_id from public.seller_product_submissions where seller_id=p_seller_id and approved_product_id is not null and lower(coalesce(status,''))='approved')
 select count(*) into v_returns from public.return_requests r join public.orders o on o.id=r.order_id where lower(coalesce(r.request_type,''))='return_refund' and exists(select 1 from seller_products sp where sp.product_id=nullif(((o.items->r.item_index)->>'id'),'')::bigint) and lower(coalesce(r.status,'')) not in ('rejected','cancelled');
 v_return_rate:=case when v_delivered>0 then round(v_returns::numeric*100/v_delivered,2) else 0 end;
 v_eligible:=v_kyc and v_payout and v_delivered>=10 and v_return_rate<=10;
 select fastpay_status into v_current from public.seller_growth_programs where seller_id=p_seller_id for update;
 if v_current is not null and v_current not in ('active','paused') then update public.seller_growth_programs set fastpay_status=case when v_eligible then 'eligible' else 'not_eligible' end,updated_at=now() where seller_id=p_seller_id; end if;
 return jsonb_build_object('eligible',v_eligible,'kyc_verified',v_kyc,'payout_verified',v_payout,'delivered_orders',v_delivered,'return_requests',v_returns,'return_rate',v_return_rate,'minimum_delivered_orders',10,'maximum_return_rate',10,'status',case when v_current in ('active','paused') then v_current when v_eligible then 'eligible' else 'not_eligible' end);
end $$;
revoke all on function public.evaluate_seller_fastpay_eligibility(uuid) from public,anon;
grant execute on function public.evaluate_seller_fastpay_eligibility(uuid) to authenticated,service_role;

create or replace function public.get_seller_growth_analytics()
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_orders bigint:=0; v_returns bigint:=0; v_return_rate numeric:=0; v_reasons jsonb:='[]'::jsonb; v_fastpay jsonb; v_verified boolean:=false;
begin
 if v_uid is null or not exists(select 1 from public.seller_profiles where user_id=v_uid) then raise exception 'Seller access required'; end if;
 select exists(select 1 from public.seller_profiles sp join public.seller_compliance_profiles sc on sc.seller_id=sp.user_id and sc.verification_status='verified' join public.seller_payout_profiles pp on pp.seller_id=sp.user_id and pp.verification_status='verified' where sp.user_id=v_uid and sp.status='active') into v_verified;
 with seller_products as (select distinct approved_product_id product_id from public.seller_product_submissions where seller_id=v_uid and approved_product_id is not null and lower(coalesce(status,''))='approved'), seller_orders as (select distinct o.id from public.orders o where exists(select 1 from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) item join seller_products sp on sp.product_id=nullif(item->>'id','')::bigint)) select count(*) into v_orders from seller_orders;
 with seller_products as (select distinct approved_product_id product_id from public.seller_product_submissions where seller_id=v_uid and approved_product_id is not null and lower(coalesce(status,''))='approved'), seller_returns as (select r.id,coalesce(nullif(trim(r.reason),''),'Other') reason from public.return_requests r join public.orders o on o.id=r.order_id where lower(coalesce(r.request_type,''))='return_refund' and exists(select 1 from seller_products sp where sp.product_id=nullif(((o.items->r.item_index)->>'id'),'')::bigint) and lower(coalesce(r.status,'')) not in ('rejected','cancelled'))
 select count(*),coalesce((select jsonb_agg(jsonb_build_object('reason',x.reason,'count',x.c) order by x.c desc,x.reason) from (select reason,count(*) c from seller_returns group by reason order by c desc,reason limit 8) x),'[]'::jsonb) into v_returns,v_reasons from seller_returns;
 v_return_rate:=case when v_orders>0 then round(v_returns::numeric*100/v_orders,2) else 0 end;
 v_fastpay:=public.evaluate_seller_fastpay_eligibility(v_uid);
 return jsonb_build_object('verified_seller',v_verified,'seller_orders',v_orders,'return_requests',v_returns,'return_rate',v_return_rate,'return_reasons',v_reasons,'fastpay',v_fastpay);
end $$;
revoke all on function public.get_seller_growth_analytics() from public,anon;
grant execute on function public.get_seller_growth_analytics() to authenticated,service_role;

create or replace function public.admin_set_seller_fastpay_status(p_seller_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_status text:=lower(trim(coalesce(p_status,''))); v_eval jsonb; begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if;
 if v_status not in ('active','paused','not_eligible') then raise exception 'Invalid FastPay status'; end if;
 v_eval:=public.evaluate_seller_fastpay_eligibility(p_seller_id);
 if v_status='active' and coalesce((v_eval->>'eligible')::boolean,false)=false then raise exception 'Seller does not meet FastPay eligibility rules'; end if;
 update public.seller_growth_programs set fastpay_status=v_status,updated_at=now() where seller_id=p_seller_id;
 if not found then raise exception 'Seller growth program not found'; end if;
 return jsonb_build_object('seller_id',p_seller_id,'status',v_status,'eligibility',v_eval);
end $$;
revoke all on function public.admin_set_seller_fastpay_status(uuid,text) from public,anon;
grant execute on function public.admin_set_seller_fastpay_status(uuid,text) to authenticated,service_role;

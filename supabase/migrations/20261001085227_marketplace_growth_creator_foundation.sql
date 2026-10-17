create table if not exists public.seller_growth_programs (
  seller_id uuid primary key references public.seller_profiles(user_id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  launch_commission_rate numeric(5,2) not null default 0 check (launch_commission_rate between 0 and 100),
  commission_ends_at timestamptz not null default (now() + interval '6 months'),
  listing_fee numeric(12,2) not null default 0 check (listing_fee >= 0),
  subscription_fee numeric(12,2) not null default 0 check (subscription_fee >= 0),
  visibility_boost_ends_at timestamptz not null default (now() + interval '30 days'),
  fastpay_status text not null default 'not_eligible' check (fastpay_status in ('not_eligible','eligible','active','paused')),
  launchpad_status text not null default 'enrolled' check (launchpad_status in ('enrolled','active','paused','completed')),
  creator_matching_enabled boolean not null default true,
  brand_story text,
  updated_at timestamptz not null default now()
);

alter table public.seller_growth_programs enable row level security;
revoke all on public.seller_growth_programs from public, anon, authenticated;
grant select on public.seller_growth_programs to authenticated;
grant insert (seller_id, brand_story, creator_matching_enabled) on public.seller_growth_programs to authenticated;
grant update (brand_story, creator_matching_enabled, updated_at) on public.seller_growth_programs to authenticated;

drop policy if exists seller_growth_select_own on public.seller_growth_programs;
create policy seller_growth_select_own on public.seller_growth_programs for select to authenticated using (seller_id = (select auth.uid()));
drop policy if exists seller_growth_insert_own on public.seller_growth_programs;
create policy seller_growth_insert_own on public.seller_growth_programs for insert to authenticated with check (seller_id = (select auth.uid()));
drop policy if exists seller_growth_update_own on public.seller_growth_programs;
create policy seller_growth_update_own on public.seller_growth_programs for update to authenticated using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));

create or replace function public.enroll_seller_growth_program()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
  insert into public.seller_growth_programs(seller_id) values(new.user_id) on conflict (seller_id) do nothing;
  return new;
end $$;
revoke all on function public.enroll_seller_growth_program() from public, anon, authenticated;

drop trigger if exists trg_enroll_seller_growth_program on public.seller_profiles;
create trigger trg_enroll_seller_growth_program after insert on public.seller_profiles for each row execute function public.enroll_seller_growth_program();
insert into public.seller_growth_programs(seller_id) select user_id from public.seller_profiles on conflict (seller_id) do nothing;

create table if not exists public.creator_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 80),
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  bio text,
  social_handle text,
  status text not null default 'pending' check (status in ('pending','approved','suspended','rejected')),
  commission_rate numeric(5,2) not null default 5 check (commission_rate between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.creator_profiles enable row level security;
revoke all on public.creator_profiles from public, anon, authenticated;
grant select on public.creator_profiles to authenticated;
grant insert (user_id, display_name, handle, bio, social_handle) on public.creator_profiles to authenticated;
grant update (display_name, handle, bio, social_handle, updated_at) on public.creator_profiles to authenticated;
drop policy if exists creator_profile_select_own on public.creator_profiles;
create policy creator_profile_select_own on public.creator_profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists creator_profile_insert_own on public.creator_profiles;
create policy creator_profile_insert_own on public.creator_profiles for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists creator_profile_update_own on public.creator_profiles;
create policy creator_profile_update_own on public.creator_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.creator_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creator_profiles(user_id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (creator_id, product_id)
);
create index if not exists creator_links_product_idx on public.creator_links(product_id);
alter table public.creator_links enable row level security;
revoke all on public.creator_links from public, anon, authenticated;
grant select on public.creator_links to authenticated;
grant insert (creator_id, product_id) on public.creator_links to authenticated;
grant update (active) on public.creator_links to authenticated;
drop policy if exists creator_links_select_own on public.creator_links;
create policy creator_links_select_own on public.creator_links for select to authenticated using (creator_id = (select auth.uid()));
drop policy if exists creator_links_insert_approved on public.creator_links;
create policy creator_links_insert_approved on public.creator_links for insert to authenticated with check (creator_id = (select auth.uid()) and exists (select 1 from public.creator_profiles cp where cp.user_id=(select auth.uid()) and cp.status='approved'));
drop policy if exists creator_links_update_own on public.creator_links;
create policy creator_links_update_own on public.creator_links for update to authenticated using (creator_id = (select auth.uid())) with check (creator_id = (select auth.uid()));

create table if not exists public.shop_looks (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creator_profiles(user_id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  cover_url text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shop_looks_creator_idx on public.shop_looks(creator_id);
alter table public.shop_looks enable row level security;
revoke all on public.shop_looks from public, anon, authenticated;
grant select on public.shop_looks to anon, authenticated;
grant insert (creator_id,title,slug,cover_url,status) on public.shop_looks to authenticated;
grant update (title,slug,cover_url,status,updated_at) on public.shop_looks to authenticated;
drop policy if exists shop_looks_public_or_own on public.shop_looks;
create policy shop_looks_public_or_own on public.shop_looks for select to anon, authenticated using (status='published' or creator_id=(select auth.uid()));
drop policy if exists shop_looks_insert_approved on public.shop_looks;
create policy shop_looks_insert_approved on public.shop_looks for insert to authenticated with check (creator_id=(select auth.uid()) and exists (select 1 from public.creator_profiles cp where cp.user_id=(select auth.uid()) and cp.status='approved'));
drop policy if exists shop_looks_update_own on public.shop_looks;
create policy shop_looks_update_own on public.shop_looks for update to authenticated using (creator_id=(select auth.uid())) with check (creator_id=(select auth.uid()));

create table if not exists public.shop_look_items (
  look_id uuid not null references public.shop_looks(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (look_id, product_id)
);
create index if not exists shop_look_items_product_idx on public.shop_look_items(product_id);
alter table public.shop_look_items enable row level security;
revoke all on public.shop_look_items from public, anon, authenticated;
grant select on public.shop_look_items to anon, authenticated;
grant insert (look_id,product_id,sort_order) on public.shop_look_items to authenticated;
grant update (sort_order) on public.shop_look_items to authenticated;
grant delete on public.shop_look_items to authenticated;
drop policy if exists shop_look_items_public_or_own on public.shop_look_items;
create policy shop_look_items_public_or_own on public.shop_look_items for select to anon, authenticated using (exists (select 1 from public.shop_looks l where l.id=look_id and (l.status='published' or l.creator_id=(select auth.uid()))));
drop policy if exists shop_look_items_insert_own on public.shop_look_items;
create policy shop_look_items_insert_own on public.shop_look_items for insert to authenticated with check (exists (select 1 from public.shop_looks l where l.id=look_id and l.creator_id=(select auth.uid())));
drop policy if exists shop_look_items_update_own on public.shop_look_items;
create policy shop_look_items_update_own on public.shop_look_items for update to authenticated using (exists (select 1 from public.shop_looks l where l.id=look_id and l.creator_id=(select auth.uid()))) with check (exists (select 1 from public.shop_looks l where l.id=look_id and l.creator_id=(select auth.uid())));
drop policy if exists shop_look_items_delete_own on public.shop_look_items;
create policy shop_look_items_delete_own on public.shop_look_items for delete to authenticated using (exists (select 1 from public.shop_looks l where l.id=look_id and l.creator_id=(select auth.uid())));

alter table public.orders add column if not exists creator_link_id uuid references public.creator_links(id) on delete set null;
create index if not exists orders_creator_link_id_idx on public.orders(creator_link_id) where creator_link_id is not null;

create or replace function public.get_creator_dashboard()
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.creator_profiles%rowtype;
  v_orders bigint := 0;
  v_value numeric := 0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.creator_profiles where user_id=v_uid;
  if v_profile.user_id is null then return jsonb_build_object('profile',null,'orders',0,'attributed_value',0,'estimated_commission',0); end if;
  select count(distinct o.id), coalesce(sum(lines.line_total),0)
  into v_orders, v_value
  from public.orders o
  join public.creator_links cl on cl.id=o.creator_link_id and cl.creator_id=v_uid
  cross join lateral (
    select coalesce(sum(coalesce((item->>'line_total')::numeric,0)),0) as line_total
    from jsonb_array_elements(o.items) item
    where nullif(item->>'id','')::bigint=cl.product_id
  ) lines
  where o.status in ('paid','cod_collected');
  return jsonb_build_object(
    'profile', jsonb_build_object('display_name',v_profile.display_name,'handle',v_profile.handle,'status',v_profile.status,'commission_rate',v_profile.commission_rate),
    'orders', v_orders,
    'attributed_value', round(v_value,2),
    'estimated_commission', round(v_value*v_profile.commission_rate/100,2)
  );
end $$;
revoke all on function public.get_creator_dashboard() from public, anon;
grant execute on function public.get_creator_dashboard() to authenticated, service_role;

create or replace function public.admin_set_creator_status(p_creator_id uuid, p_status text, p_commission_rate numeric default null)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_status text:=lower(trim(coalesce(p_status,''))); begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and is_admin=true) then raise exception 'Administrator access required'; end if;
 if v_status not in ('pending','approved','suspended','rejected') then raise exception 'Invalid creator status'; end if;
 if p_commission_rate is not null and (p_commission_rate<0 or p_commission_rate>100) then raise exception 'Invalid commission rate'; end if;
 update public.creator_profiles set status=v_status, commission_rate=coalesce(p_commission_rate,commission_rate), updated_at=now() where user_id=p_creator_id;
 if not found then raise exception 'Creator not found'; end if;
 return (select jsonb_build_object('user_id',user_id,'display_name',display_name,'handle',handle,'status',status,'commission_rate',commission_rate) from public.creator_profiles where user_id=p_creator_id);
end $$;
revoke all on function public.admin_set_creator_status(uuid,text,numeric) from public, anon;
grant execute on function public.admin_set_creator_status(uuid,text,numeric) to authenticated, service_role;

create or replace function public.admin_upsert_seller_settlement_breakdown(p_seller_id uuid, p_settlement_id bigint, p_period_start date, p_period_end date, p_gross_amount numeric, p_platform_commission_amount numeric DEFAULT 0, p_commission_gst_amount numeric DEFAULT 0, p_payment_fee_amount numeric DEFAULT 0, p_shipping_deduction_amount numeric DEFAULT 0, p_return_deduction_amount numeric DEFAULT 0, p_other_deduction_amount numeric DEFAULT 0, p_refunds_amount numeric DEFAULT 0, p_status text DEFAULT 'pending'::text, p_provider_payout_ref text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare
  v_uid uuid:=auth.uid(); v_status text:=lower(trim(coalesce(p_status,''))); v_ref text:=nullif(trim(coalesce(p_provider_payout_ref,'')),''); v_failure text:=nullif(trim(coalesce(p_failure_reason,'')),''); v_note text:=nullif(trim(coalesce(p_note,'')),''); v_id bigint; v_old_status text; v_existing_provider_ref text; v_existing_provider_status text; v_fees numeric(14,2); v_net numeric(14,2); v_now timestamptz:=now(); v_platform numeric(14,2):=coalesce(p_platform_commission_amount,0); v_commission_gst numeric(14,2):=coalesce(p_commission_gst_amount,0); v_launch_zero boolean:=false;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then raise exception 'Seller not found'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=p_seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=p_seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'Invalid settlement period'; end if;
  if coalesce(p_gross_amount,-1)<0 or coalesce(p_platform_commission_amount,-1)<0 or coalesce(p_commission_gst_amount,-1)<0 or coalesce(p_payment_fee_amount,-1)<0 or coalesce(p_shipping_deduction_amount,-1)<0 or coalesce(p_return_deduction_amount,-1)<0 or coalesce(p_other_deduction_amount,-1)<0 or coalesce(p_refunds_amount,-1)<0 then raise exception 'Settlement amounts must be non-negative'; end if;
  select exists(select 1 from public.seller_growth_programs g where g.seller_id=p_seller_id and g.launch_commission_rate=0 and g.commission_ends_at>v_now) into v_launch_zero;
  if v_launch_zero then v_platform:=0; v_commission_gst:=0; end if;
  v_fees:=round((v_platform+v_commission_gst+coalesce(p_payment_fee_amount,0)+coalesce(p_shipping_deduction_amount,0)+coalesce(p_return_deduction_amount,0)+coalesce(p_other_deduction_amount,0))::numeric,2);
  v_net:=round((p_gross_amount-v_fees-p_refunds_amount)::numeric,2);
  if v_net<0 then raise exception 'Settlement net amount cannot be negative'; end if;
  if v_status not in ('pending','processing','failed','held') then raise exception 'Invalid settlement status. Use manual payout recording to mark a settlement paid.'; end if;
  if v_status='failed' and v_failure is null then raise exception 'Failure reason is required'; end if;
  if p_settlement_id is null then
    insert into public.seller_settlements(seller_id,period_start,period_end,gross_amount,platform_commission_amount,commission_gst_amount,payment_fee_amount,shipping_deduction_amount,return_deduction_amount,other_deduction_amount,fees_amount,refunds_amount,net_amount,currency,status,provider_payout_ref,failure_reason,paid_at,created_by,updated_by,created_at,updated_at)
    values(p_seller_id,p_period_start,p_period_end,round(p_gross_amount,2),round(v_platform,2),round(v_commission_gst,2),round(p_payment_fee_amount,2),round(p_shipping_deduction_amount,2),round(p_return_deduction_amount,2),round(p_other_deduction_amount,2),v_fees,round(p_refunds_amount,2),v_net,'INR',v_status,v_ref,case when v_status='failed' then v_failure else null end,null,v_uid,v_uid,v_now,v_now) returning id into v_id;
  else
    select status,provider_payout_ref,provider_status into v_old_status,v_existing_provider_ref,v_existing_provider_status from public.seller_settlements where id=p_settlement_id and seller_id=p_seller_id for update;
    if v_old_status is null then raise exception 'Settlement not found'; end if;
    if v_old_status='paid' then raise exception 'Paid settlements are immutable'; end if;
    if v_existing_provider_ref is not null and lower(coalesce(v_existing_provider_status,'')) not in ('failed','rejected','cancelled','reversed') then raise exception 'Settlement with an active provider payout cannot be edited'; end if;
    update public.seller_settlements set period_start=p_period_start,period_end=p_period_end,gross_amount=round(p_gross_amount,2),platform_commission_amount=round(v_platform,2),commission_gst_amount=round(v_commission_gst,2),payment_fee_amount=round(p_payment_fee_amount,2),shipping_deduction_amount=round(p_shipping_deduction_amount,2),return_deduction_amount=round(p_return_deduction_amount,2),other_deduction_amount=round(p_other_deduction_amount,2),fees_amount=v_fees,refunds_amount=round(p_refunds_amount,2),net_amount=v_net,status=v_status,provider_payout_ref=v_ref,failure_reason=case when v_status='failed' then v_failure else null end,paid_at=null,updated_by=v_uid,updated_at=v_now where id=p_settlement_id and seller_id=p_seller_id returning id into v_id;
  end if;
  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id) values(v_id,p_seller_id,v_old_status,v_status,coalesce(v_note,'Settlement deductions updated')||case when v_launch_zero then ' · launch commission ₹0.00' else '' end||' · total deductions ₹'||to_char(v_fees+round(p_refunds_amount,2),'FM9999999990.00'),v_uid);
  return (select to_jsonb(s)-'provider_payout_ref'-'payout_idempotency_key'-'provider_status_details'-'created_by'-'updated_by' from public.seller_settlements s where s.id=v_id);
end $$;
revoke all on function public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text) from public, anon;
grant execute on function public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text) to authenticated, service_role;

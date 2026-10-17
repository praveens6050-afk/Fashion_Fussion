-- Recovery bundle reconstructed from production supabase_migrations.schema_migrations.
-- It replays the lost 20260924114930..20260924192044 migrations in their original order.

-- BEGIN RECOVERED 20260924114930_seller_operational_read_model
create or replace function public.get_seller_operations()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.seller_profiles sp
    where sp.user_id = v_uid and sp.status = 'active'
  ) then
    raise exception 'Active seller profile required';
  end if;

  with owned_products as (
    select distinct s.approved_product_id as product_id
    from public.seller_product_submissions s
    where s.seller_id = v_uid
      and s.approved_product_id is not null
  ), seller_lines as (
    select
      o.id as order_id,
      o.display_order_id,
      o.created_at,
      o.status,
      o.fulfillment_status,
      o.payment_method,
      o.payment_verified_at,
      o.currency,
      o.customer_name,
      o.customer_phone,
      o.shipping_address,
      line.ord::int - 1 as item_index,
      line.item,
      case when coalesce(line.item->>'line_total','') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (line.item->>'line_total')::numeric else 0 end as line_total
    from public.orders o
    cross join lateral jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) with ordinality as line(item, ord)
    join owned_products op
      on coalesce(line.item->>'id','') ~ '^[0-9]+$'
     and (line.item->>'id')::bigint = op.product_id
  ), order_rows as (
    select
      order_id,
      display_order_id,
      min(created_at) as created_at,
      min(status) as status,
      min(fulfillment_status) as fulfillment_status,
      min(payment_method) as payment_method,
      min(payment_verified_at) as payment_verified_at,
      min(currency) as currency,
      min(customer_name) as customer_name,
      min(customer_phone) as customer_phone,
      min(shipping_address::text)::jsonb as shipping_address,
      sum(line_total) as seller_total,
      jsonb_agg(item order by item_index) as items
    from seller_lines
    group by order_id, display_order_id
  ), seller_returns as (
    select r.*, sl.item
    from public.return_requests r
    join seller_lines sl on sl.order_id = r.order_id and sl.item_index = r.item_index
  )
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', order_id,
        'display_order_id', display_order_id,
        'created_at', created_at,
        'status', status,
        'fulfillment_status', fulfillment_status,
        'payment_method', payment_method,
        'payment_verified_at', payment_verified_at,
        'currency', currency,
        'customer_name', customer_name,
        'customer_phone', customer_phone,
        'shipping_address', shipping_address,
        'seller_total', seller_total,
        'items', items
      ) order by created_at desc)
      from order_rows
    ), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'order_id', order_id,
        'item_index', item_index,
        'request_type', request_type,
        'quantity', quantity,
        'reason', reason,
        'requested_size', requested_size,
        'status', status,
        'admin_note', admin_note,
        'created_at', created_at,
        'updated_at', updated_at,
        'resolved_at', resolved_at,
        'refund_status', refund_status,
        'refund_amount', refund_amount,
        'item', item
      ) order by created_at desc)
      from seller_returns
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'order_count', (select count(*) from order_rows),
      'gross_sales', coalesce((select sum(seller_total) from order_rows where status not in ('cod_cancelled','cancelled','failed')),0),
      'paid_sales', coalesce((select sum(seller_total) from order_rows where payment_verified_at is not null and status not in ('cod_cancelled','cancelled','failed')),0),
      'pending_sales', coalesce((select sum(seller_total) from order_rows where payment_verified_at is null and status not in ('cod_cancelled','cancelled','failed')),0),
      'return_count', (select count(*) from seller_returns)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_seller_operations() from public, anon;
grant execute on function public.get_seller_operations() to authenticated, service_role;
comment on function public.get_seller_operations() is 'Returns only orders and return rows whose product IDs belong to the authenticated seller via approved seller submissions.';
notify pgrst, 'reload schema';
-- END RECOVERED 20260924114930

-- BEGIN RECOVERED 20260924120100_seller_compliance_payout_logistics
create table if not exists public.seller_compliance_profiles (
  seller_id uuid primary key references public.seller_profiles(user_id) on delete cascade,
  legal_name text,
  trade_name text,
  entity_type text not null default 'individual' check (entity_type in ('individual','business','manufacturer','wholesaler')),
  primary_category text,
  gst_registered boolean not null default false,
  pan_last4 text,
  gstin_last4 text,
  verification_status text not null default 'draft' check (verification_status in ('draft','pending_review','verified','rejected')),
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_payout_profiles (
  seller_id uuid primary key references public.seller_profiles(user_id) on delete cascade,
  account_holder_name text,
  bank_name text,
  ifsc text,
  account_number_last4 text,
  account_type text not null default 'current' check (account_type in ('current','savings')),
  provider_fund_account_ref text,
  verification_status text not null default 'draft' check (verification_status in ('draft','pending_review','verified','rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_pickup_locations (
  id bigint generated by default as identity primary key,
  seller_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  label text not null default 'Primary pickup',
  contact_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  pincode text not null,
  landmark text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone ~ '^[0-9]{10}$'),
  check (pincode ~ '^[1-9][0-9]{5}$')
);

create unique index if not exists seller_pickup_one_default_idx
  on public.seller_pickup_locations(seller_id)
  where is_default and is_active;

create table if not exists public.seller_settlements (
  id bigint generated by default as identity primary key,
  seller_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  period_start date not null,
  period_end date not null,
  gross_amount numeric(14,2) not null default 0,
  fees_amount numeric(14,2) not null default 0,
  refunds_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  currency text not null default 'INR',
  status text not null default 'pending' check (status in ('pending','processing','paid','failed','held')),
  provider_payout_ref text,
  failure_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

alter table public.seller_compliance_profiles enable row level security;
alter table public.seller_payout_profiles enable row level security;
alter table public.seller_pickup_locations enable row level security;
alter table public.seller_settlements enable row level security;

drop policy if exists seller_compliance_read_own on public.seller_compliance_profiles;
create policy seller_compliance_read_own on public.seller_compliance_profiles for select to authenticated using (seller_id = auth.uid());
drop policy if exists seller_payout_read_own on public.seller_payout_profiles;
create policy seller_payout_read_own on public.seller_payout_profiles for select to authenticated using (seller_id = auth.uid());
drop policy if exists seller_pickup_read_own on public.seller_pickup_locations;
create policy seller_pickup_read_own on public.seller_pickup_locations for select to authenticated using (seller_id = auth.uid());
drop policy if exists seller_settlement_read_own on public.seller_settlements;
create policy seller_settlement_read_own on public.seller_settlements for select to authenticated using (seller_id = auth.uid());

revoke insert, update, delete on public.seller_compliance_profiles from authenticated;
revoke insert, update, delete on public.seller_payout_profiles from authenticated;
revoke insert, update, delete on public.seller_pickup_locations from authenticated;
revoke insert, update, delete on public.seller_settlements from authenticated;
grant select on public.seller_compliance_profiles, public.seller_payout_profiles, public.seller_pickup_locations, public.seller_settlements to authenticated;

create or replace function public.save_seller_compliance_profile(
  p_legal_name text,
  p_trade_name text,
  p_entity_type text,
  p_primary_category text,
  p_gst_registered boolean,
  p_pan text,
  p_gstin text,
  p_account_holder_name text,
  p_bank_name text,
  p_ifsc text,
  p_account_number text,
  p_account_type text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid := auth.uid();
  v_pan text := upper(regexp_replace(coalesce(p_pan,''), '[^A-Za-z0-9]', '', 'g'));
  v_gstin text := upper(regexp_replace(coalesce(p_gstin,''), '[^A-Za-z0-9]', '', 'g'));
  v_account text := regexp_replace(coalesce(p_account_number,''), '[^0-9]', '', 'g');
  v_ifsc text := upper(trim(coalesce(p_ifsc,'')));
begin
  if v_seller is null or not exists(select 1 from public.seller_profiles where user_id=v_seller and status='active') then
    raise exception 'Active seller account required';
  end if;
  if nullif(trim(coalesce(p_legal_name,'')),'') is null then raise exception 'Legal name is required'; end if;
  if coalesce(p_entity_type,'') not in ('individual','business','manufacturer','wholesaler') then raise exception 'Invalid entity type'; end if;
  if v_pan <> '' and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Invalid PAN format'; end if;
  if coalesce(p_gst_registered,false) and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'Valid GSTIN is required'; end if;
  if nullif(trim(coalesce(p_account_holder_name,'')),'') is not null or nullif(trim(coalesce(p_bank_name,'')),'') is not null or v_ifsc <> '' or v_account <> '' then
    if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Invalid IFSC format'; end if;
    if v_account !~ '^[0-9]{9,18}$' then raise exception 'Invalid bank account number'; end if;
    if coalesce(p_account_type,'') not in ('current','savings') then raise exception 'Invalid account type'; end if;
  end if;

  insert into public.seller_compliance_profiles(seller_id,legal_name,trade_name,entity_type,primary_category,gst_registered,pan_last4,gstin_last4,verification_status,rejection_reason,updated_at)
  values(v_seller,trim(p_legal_name),nullif(trim(p_trade_name),''),p_entity_type,nullif(trim(p_primary_category),''),coalesce(p_gst_registered,false),case when v_pan='' then null else right(v_pan,4) end,case when v_gstin='' then null else right(v_gstin,4) end,'draft',null,now())
  on conflict(seller_id) do update set legal_name=excluded.legal_name,trade_name=excluded.trade_name,entity_type=excluded.entity_type,primary_category=excluded.primary_category,gst_registered=excluded.gst_registered,pan_last4=excluded.pan_last4,gstin_last4=excluded.gstin_last4,verification_status=case when seller_compliance_profiles.verification_status='verified' then 'verified' else 'draft' end,rejection_reason=null,updated_at=now();

  if nullif(trim(coalesce(p_account_holder_name,'')),'') is not null or nullif(trim(coalesce(p_bank_name,'')),'') is not null or v_ifsc <> '' or v_account <> '' then
    insert into public.seller_payout_profiles(seller_id,account_holder_name,bank_name,ifsc,account_number_last4,account_type,verification_status,rejection_reason,updated_at)
    values(v_seller,trim(p_account_holder_name),trim(p_bank_name),v_ifsc,right(v_account,4),p_account_type,'draft',null,now())
    on conflict(seller_id) do update set account_holder_name=excluded.account_holder_name,bank_name=excluded.bank_name,ifsc=excluded.ifsc,account_number_last4=excluded.account_number_last4,account_type=excluded.account_type,verification_status=case when seller_payout_profiles.verification_status='verified' then 'verified' else 'draft' end,rejection_reason=null,updated_at=now();
  end if;

  return public.get_seller_finance_profile();
end $$;

create or replace function public.save_seller_pickup_location(
  p_location_id bigint,
  p_label text,
  p_contact_name text,
  p_phone text,
  p_line1 text,
  p_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_landmark text,
  p_is_default boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid := auth.uid();
  v_id bigint;
  v_phone text := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  v_pin text := regexp_replace(coalesce(p_pincode,''), '[^0-9]', '', 'g');
begin
  if v_seller is null or not exists(select 1 from public.seller_profiles where user_id=v_seller and status='active') then raise exception 'Active seller account required'; end if;
  if nullif(trim(coalesce(p_contact_name,'')),'') is null or nullif(trim(coalesce(p_line1,'')),'') is null or nullif(trim(coalesce(p_city,'')),'') is null or nullif(trim(coalesce(p_state,'')),'') is null then raise exception 'Complete pickup address'; end if;
  if v_phone !~ '^[0-9]{10}$' then raise exception 'Invalid phone number'; end if;
  if v_pin !~ '^[1-9][0-9]{5}$' then raise exception 'Invalid pincode'; end if;
  if coalesce(p_is_default,false) then update public.seller_pickup_locations set is_default=false,updated_at=now() where seller_id=v_seller and is_default; end if;
  if p_location_id is null then
    insert into public.seller_pickup_locations(seller_id,label,contact_name,phone,line1,line2,city,state,pincode,landmark,is_default)
    values(v_seller,coalesce(nullif(trim(p_label),''),'Primary pickup'),trim(p_contact_name),v_phone,trim(p_line1),nullif(trim(p_line2),''),trim(p_city),trim(p_state),v_pin,nullif(trim(p_landmark),''),coalesce(p_is_default,false)) returning id into v_id;
  else
    update public.seller_pickup_locations set label=coalesce(nullif(trim(p_label),''),'Primary pickup'),contact_name=trim(p_contact_name),phone=v_phone,line1=trim(p_line1),line2=nullif(trim(p_line2),''),city=trim(p_city),state=trim(p_state),pincode=v_pin,landmark=nullif(trim(p_landmark),''),is_default=coalesce(p_is_default,false),updated_at=now() where id=p_location_id and seller_id=v_seller returning id into v_id;
    if v_id is null then raise exception 'Pickup location not found'; end if;
  end if;
  return public.get_seller_finance_profile();
end $$;

create or replace function public.submit_seller_verification() returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_seller uuid := auth.uid();
begin
  if v_seller is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.seller_compliance_profiles where seller_id=v_seller and legal_name is not null and pan_last4 is not null and (not gst_registered or gstin_last4 is not null)) then raise exception 'Complete business identity first'; end if;
  if not exists(select 1 from public.seller_payout_profiles where seller_id=v_seller and account_holder_name is not null and bank_name is not null and ifsc is not null and account_number_last4 is not null) then raise exception 'Complete payout account first'; end if;
  if not exists(select 1 from public.seller_pickup_locations where seller_id=v_seller and is_active) then raise exception 'Add a pickup location first'; end if;
  update public.seller_compliance_profiles set verification_status='pending_review',submitted_at=now(),rejection_reason=null,updated_at=now() where seller_id=v_seller and verification_status<>'verified';
  update public.seller_payout_profiles set verification_status='pending_review',rejection_reason=null,updated_at=now() where seller_id=v_seller and verification_status<>'verified';
  return public.get_seller_finance_profile();
end $$;

create or replace function public.get_seller_finance_profile() returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'compliance', coalesce((select to_jsonb(c) - 'seller_id' from public.seller_compliance_profiles c where c.seller_id=auth.uid()), '{}'::jsonb),
    'payout', coalesce((select (to_jsonb(p) - 'seller_id' - 'provider_fund_account_ref') from public.seller_payout_profiles p where p.seller_id=auth.uid()), '{}'::jsonb),
    'pickup_locations', coalesce((select jsonb_agg(to_jsonb(l) - 'seller_id' order by l.is_default desc,l.updated_at desc) from public.seller_pickup_locations l where l.seller_id=auth.uid() and l.is_active), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg((to_jsonb(s) - 'seller_id' - 'provider_payout_ref') order by s.period_end desc,s.id desc) from public.seller_settlements s where s.seller_id=auth.uid()), '[]'::jsonb)
  )
$$;

grant execute on function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.save_seller_pickup_location(bigint,text,text,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.submit_seller_verification() to authenticated;
grant execute on function public.get_seller_finance_profile() to authenticated;
-- END RECOVERED 20260924120100

-- BEGIN RECOVERED 20260924121132_admin_seller_finance_review_controls
alter table public.seller_compliance_profiles add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.seller_payout_profiles add column if not exists reviewed_at timestamptz;
alter table public.seller_payout_profiles add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.seller_settlements add column if not exists created_by uuid references public.profiles(id);
alter table public.seller_settlements add column if not exists updated_by uuid references public.profiles(id);

create table if not exists public.seller_finance_review_events (
  id bigint generated by default as identity primary key,
  seller_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  review_scope text not null check (review_scope in ('kyc','payout','both')),
  decision text not null check (decision in ('approve','reject')),
  reason text,
  reviewer_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (decision <> 'reject' or nullif(trim(coalesce(reason,'')),'') is not null)
);

create table if not exists public.seller_settlement_events (
  id bigint generated by default as identity primary key,
  settlement_id bigint not null references public.seller_settlements(id) on delete cascade,
  seller_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  old_status text,
  new_status text not null,
  note text,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.seller_finance_review_events enable row level security;
alter table public.seller_settlement_events enable row level security;
revoke all on public.seller_finance_review_events from anon, authenticated;
revoke all on public.seller_settlement_events from anon, authenticated;

create or replace function public.admin_list_seller_finance_reviews(
  p_status text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := nullif(trim(coalesce(p_status,'')), '');
  v_search text := nullif(trim(coalesce(p_search,'')), '');
  v_limit integer := least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;

  select coalesce(jsonb_agg(item order by submitted_sort asc, created_sort desc), '[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'seller_id', s.user_id,
        'seller_code', s.seller_code,
        'store_name', s.store_name,
        'seller_type', s.seller_type,
        'seller_status', s.status,
        'email', u.email,
        'phone', s.phone,
        'compliance', case when c.seller_id is null then '{}'::jsonb else jsonb_build_object(
          'legal_name', c.legal_name,
          'trade_name', c.trade_name,
          'entity_type', c.entity_type,
          'primary_category', c.primary_category,
          'gst_registered', c.gst_registered,
          'pan_last4', c.pan_last4,
          'gstin_last4', c.gstin_last4,
          'verification_status', c.verification_status,
          'rejection_reason', c.rejection_reason,
          'submitted_at', c.submitted_at,
          'reviewed_at', c.reviewed_at,
          'updated_at', c.updated_at
        ) end,
        'payout', case when pp.seller_id is null then '{}'::jsonb else jsonb_build_object(
          'account_holder_name', pp.account_holder_name,
          'bank_name', pp.bank_name,
          'ifsc', pp.ifsc,
          'account_number_last4', pp.account_number_last4,
          'account_type', pp.account_type,
          'verification_status', pp.verification_status,
          'rejection_reason', pp.rejection_reason,
          'reviewed_at', pp.reviewed_at,
          'updated_at', pp.updated_at
        ) end,
        'pickup_locations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id,'label',l.label,'contact_name',l.contact_name,'phone',l.phone,
            'line1',l.line1,'line2',l.line2,'city',l.city,'state',l.state,'pincode',l.pincode,
            'landmark',l.landmark,'is_default',l.is_default,'is_active',l.is_active
          ) order by l.is_default desc,l.updated_at desc)
          from public.seller_pickup_locations l
          where l.seller_id=s.user_id and l.is_active
        ), '[]'::jsonb),
        'settlements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', st.id,'period_start',st.period_start,'period_end',st.period_end,
            'gross_amount',st.gross_amount,'fees_amount',st.fees_amount,'refunds_amount',st.refunds_amount,
            'net_amount',st.net_amount,'currency',st.currency,'status',st.status,
            'failure_reason',st.failure_reason,'paid_at',st.paid_at,'created_at',st.created_at,'updated_at',st.updated_at
          ) order by st.period_end desc,st.id desc)
          from public.seller_settlements st where st.seller_id=s.user_id
        ), '[]'::jsonb),
        'recent_reviews', coalesce((
          select jsonb_agg(jsonb_build_object(
            'scope', e.review_scope,'decision',e.decision,'reason',e.reason,'created_at',e.created_at
          ) order by e.created_at desc)
          from (select * from public.seller_finance_review_events x where x.seller_id=s.user_id order by x.created_at desc limit 8) e
        ), '[]'::jsonb)
      ) as item,
      coalesce(c.submitted_at, '9999-12-31'::timestamptz) as submitted_sort,
      s.created_at as created_sort
    from public.seller_profiles s
    join auth.users u on u.id=s.user_id
    left join public.seller_compliance_profiles c on c.seller_id=s.user_id
    left join public.seller_payout_profiles pp on pp.seller_id=s.user_id
    where (
      v_status is null
      or c.verification_status=v_status
      or pp.verification_status=v_status
    )
    and (
      v_search is null
      or s.seller_code ilike '%'||v_search||'%'
      or s.store_name ilike '%'||v_search||'%'
      or coalesce(u.email,'') ilike '%'||v_search||'%'
      or coalesce(c.legal_name,'') ilike '%'||v_search||'%'
    )
    order by submitted_sort asc, created_sort desc
    limit v_limit offset v_offset
  ) q;
  return v_result;
end $$;

create or replace function public.admin_review_seller_finance(
  p_seller_id uuid,
  p_scope text,
  p_decision text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope,'')));
  v_decision text := lower(trim(coalesce(p_decision,'')));
  v_reason text := nullif(trim(coalesce(p_reason,'')), '');
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then raise exception 'Seller not found'; end if;
  if v_scope not in ('kyc','payout','both') then raise exception 'Invalid review scope'; end if;
  if v_decision not in ('approve','reject') then raise exception 'Invalid review decision'; end if;
  if v_decision='reject' and v_reason is null then raise exception 'Rejection reason is required'; end if;

  if v_scope in ('kyc','both') then
    if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=p_seller_id and c.verification_status='pending_review') then
      raise exception 'KYC is not pending review';
    end if;
    update public.seller_compliance_profiles
      set verification_status=case when v_decision='approve' then 'verified' else 'rejected' end,
          rejection_reason=case when v_decision='reject' then v_reason else null end,
          reviewed_at=v_now, reviewed_by=v_uid, updated_at=v_now
      where seller_id=p_seller_id;
  end if;

  if v_scope in ('payout','both') then
    if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=p_seller_id and p.verification_status='pending_review') then
      raise exception 'Payout account is not pending review';
    end if;
    update public.seller_payout_profiles
      set verification_status=case when v_decision='approve' then 'verified' else 'rejected' end,
          rejection_reason=case when v_decision='reject' then v_reason else null end,
          reviewed_at=v_now, reviewed_by=v_uid, updated_at=v_now
      where seller_id=p_seller_id;
  end if;

  insert into public.seller_finance_review_events(seller_id,review_scope,decision,reason,reviewer_id)
  values(p_seller_id,v_scope,v_decision,v_reason,v_uid);

  return jsonb_build_object('ok',true,'seller_id',p_seller_id,'scope',v_scope,'decision',v_decision,'reviewed_at',v_now);
end $$;

create or replace function public.admin_upsert_seller_settlement(
  p_seller_id uuid,
  p_settlement_id bigint,
  p_period_start date,
  p_period_end date,
  p_gross_amount numeric,
  p_fees_amount numeric,
  p_refunds_amount numeric,
  p_status text,
  p_provider_payout_ref text default null,
  p_failure_reason text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status,'')));
  v_ref text := nullif(trim(coalesce(p_provider_payout_ref,'')), '');
  v_failure text := nullif(trim(coalesce(p_failure_reason,'')), '');
  v_note text := nullif(trim(coalesce(p_note,'')), '');
  v_id bigint;
  v_old_status text;
  v_net numeric(14,2);
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then raise exception 'Seller not found'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=p_seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=p_seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'Invalid settlement period'; end if;
  if coalesce(p_gross_amount,-1) < 0 or coalesce(p_fees_amount,-1) < 0 or coalesce(p_refunds_amount,-1) < 0 then raise exception 'Settlement amounts must be non-negative'; end if;
  v_net := round((p_gross_amount-p_fees_amount-p_refunds_amount)::numeric,2);
  if v_net < 0 then raise exception 'Settlement net amount cannot be negative'; end if;
  if v_status not in ('pending','processing','paid','failed','held') then raise exception 'Invalid settlement status'; end if;
  if v_status='failed' and v_failure is null then raise exception 'Failure reason is required'; end if;

  if p_settlement_id is null then
    insert into public.seller_settlements(
      seller_id,period_start,period_end,gross_amount,fees_amount,refunds_amount,net_amount,currency,status,
      provider_payout_ref,failure_reason,paid_at,created_by,updated_by,created_at,updated_at
    ) values(
      p_seller_id,p_period_start,p_period_end,round(p_gross_amount,2),round(p_fees_amount,2),round(p_refunds_amount,2),v_net,'INR',v_status,
      v_ref,case when v_status='failed' then v_failure else null end,case when v_status='paid' then v_now else null end,v_uid,v_uid,v_now,v_now
    ) returning id into v_id;
  else
    select status into v_old_status from public.seller_settlements where id=p_settlement_id and seller_id=p_seller_id for update;
    if v_old_status is null then raise exception 'Settlement not found'; end if;
    update public.seller_settlements
      set period_start=p_period_start,period_end=p_period_end,gross_amount=round(p_gross_amount,2),fees_amount=round(p_fees_amount,2),
          refunds_amount=round(p_refunds_amount,2),net_amount=v_net,status=v_status,provider_payout_ref=v_ref,
          failure_reason=case when v_status='failed' then v_failure else null end,
          paid_at=case when v_status='paid' then coalesce(paid_at,v_now) else null end,
          updated_by=v_uid,updated_at=v_now
      where id=p_settlement_id and seller_id=p_seller_id
      returning id into v_id;
  end if;

  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_id,p_seller_id,v_old_status,v_status,v_note,v_uid);

  return (select jsonb_build_object(
    'id',s.id,'seller_id',s.seller_id,'period_start',s.period_start,'period_end',s.period_end,
    'gross_amount',s.gross_amount,'fees_amount',s.fees_amount,'refunds_amount',s.refunds_amount,'net_amount',s.net_amount,
    'currency',s.currency,'status',s.status,'failure_reason',s.failure_reason,'paid_at',s.paid_at,'created_at',s.created_at,'updated_at',s.updated_at
  ) from public.seller_settlements s where s.id=v_id);
end $$;

revoke all on function public.admin_list_seller_finance_reviews(text,text,integer,integer) from public;
revoke all on function public.admin_review_seller_finance(uuid,text,text,text) from public;
revoke all on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) from public;
grant execute on function public.admin_list_seller_finance_reviews(text,text,integer,integer) to authenticated;
grant execute on function public.admin_review_seller_finance(uuid,text,text,text) to authenticated;
grant execute on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) to authenticated;
-- END RECOVERED 20260924121132

-- BEGIN RECOVERED 20260924130042_seller_payout_provider_tokenization
alter table public.seller_payout_profiles add column if not exists provider_name text;
alter table public.seller_payout_profiles add column if not exists provider_contact_ref text;
alter table public.seller_payout_profiles add column if not exists provider_tokenized_at timestamptz;
alter table public.seller_payout_profiles add column if not exists provider_last_error text;
create unique index if not exists seller_payout_provider_fund_ref_uidx on public.seller_payout_profiles(provider_fund_account_ref) where provider_fund_account_ref is not null;

alter table public.seller_settlements add column if not exists payout_mode text;
alter table public.seller_settlements add column if not exists payout_idempotency_key text;
alter table public.seller_settlements add column if not exists provider_status text;
alter table public.seller_settlements add column if not exists provider_utr text;
alter table public.seller_settlements add column if not exists provider_status_details jsonb;
alter table public.seller_settlements add column if not exists provider_synced_at timestamptz;
create unique index if not exists seller_settlement_provider_ref_uidx on public.seller_settlements(provider_payout_ref) where provider_payout_ref is not null;
create unique index if not exists seller_settlement_idempotency_uidx on public.seller_settlements(payout_idempotency_key) where payout_idempotency_key is not null;

create or replace function public.get_seller_finance_profile() returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'compliance', coalesce((select to_jsonb(c) - 'seller_id' - 'reviewed_by' from public.seller_compliance_profiles c where c.seller_id=auth.uid()), '{}'::jsonb),
    'payout', coalesce((select (to_jsonb(p) - 'seller_id' - 'provider_fund_account_ref' - 'provider_contact_ref' - 'provider_last_error' - 'reviewed_by') || jsonb_build_object('provider_linked', p.provider_fund_account_ref is not null) from public.seller_payout_profiles p where p.seller_id=auth.uid()), '{}'::jsonb),
    'pickup_locations', coalesce((select jsonb_agg(to_jsonb(l) - 'seller_id' order by l.is_default desc,l.updated_at desc) from public.seller_pickup_locations l where l.seller_id=auth.uid() and l.is_active), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg((to_jsonb(s) - 'seller_id' - 'provider_payout_ref' - 'payout_idempotency_key' - 'provider_status_details' - 'created_by' - 'updated_by') order by s.period_end desc,s.id desc) from public.seller_settlements s where s.seller_id=auth.uid()), '[]'::jsonb)
  )
$$;

create or replace function public.save_seller_compliance_profile(
  p_legal_name text,p_trade_name text,p_entity_type text,p_primary_category text,p_gst_registered boolean,p_pan text,p_gstin text,
  p_account_holder_name text,p_bank_name text,p_ifsc text,p_account_number text,p_account_type text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_seller uuid:=auth.uid();
  v_pan text:=upper(regexp_replace(coalesce(p_pan,''),'[^A-Za-z0-9]','','g'));
  v_gstin text:=upper(regexp_replace(coalesce(p_gstin,''),'[^A-Za-z0-9]','','g'));
  v_account text:=regexp_replace(coalesce(p_account_number,''),'[^0-9]','','g');
  v_ifsc text:=upper(trim(coalesce(p_ifsc,'')));
  v_old_c public.seller_compliance_profiles%rowtype;
  v_old_p public.seller_payout_profiles%rowtype;
  v_pan_last4 text;
  v_gstin_last4 text;
  v_account_last4 text;
  v_identity_changed boolean:=false;
  v_payout_changed boolean:=false;
begin
  if v_seller is null or not exists(select 1 from public.seller_profiles where user_id=v_seller and status='active') then raise exception 'Active seller account required'; end if;
  select * into v_old_c from public.seller_compliance_profiles where seller_id=v_seller;
  select * into v_old_p from public.seller_payout_profiles where seller_id=v_seller;
  if nullif(trim(coalesce(p_legal_name,'')),'') is null then raise exception 'Legal name is required'; end if;
  if coalesce(p_entity_type,'') not in ('individual','business','manufacturer','wholesaler') then raise exception 'Invalid entity type'; end if;
  if v_pan<>'' and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Invalid PAN format'; end if;
  v_pan_last4:=case when v_pan<>'' then right(v_pan,4) else v_old_c.pan_last4 end;
  if v_pan_last4 is null then raise exception 'PAN is required'; end if;
  if coalesce(p_gst_registered,false) then
    if v_gstin<>'' and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'Invalid GSTIN format'; end if;
    v_gstin_last4:=case when v_gstin<>'' then right(v_gstin,4) else v_old_c.gstin_last4 end;
    if v_gstin_last4 is null then raise exception 'Valid GSTIN is required'; end if;
  else v_gstin_last4:=null; end if;
  v_identity_changed:=v_old_c.seller_id is not null and (
    trim(coalesce(v_old_c.legal_name,''))<>trim(coalesce(p_legal_name,'')) or
    coalesce(v_old_c.entity_type,'')<>coalesce(p_entity_type,'') or
    coalesce(v_old_c.gst_registered,false)<>coalesce(p_gst_registered,false) or
    coalesce(v_old_c.pan_last4,'')<>coalesce(v_pan_last4,'') or
    coalesce(v_old_c.gstin_last4,'')<>coalesce(v_gstin_last4,'')
  );

  insert into public.seller_compliance_profiles(seller_id,legal_name,trade_name,entity_type,primary_category,gst_registered,pan_last4,gstin_last4,verification_status,rejection_reason,reviewed_at,reviewed_by,updated_at)
  values(v_seller,trim(p_legal_name),nullif(trim(p_trade_name),''),p_entity_type,nullif(trim(p_primary_category),''),coalesce(p_gst_registered,false),v_pan_last4,v_gstin_last4,'draft',null,null,null,now())
  on conflict(seller_id) do update set legal_name=excluded.legal_name,trade_name=excluded.trade_name,entity_type=excluded.entity_type,primary_category=excluded.primary_category,gst_registered=excluded.gst_registered,pan_last4=excluded.pan_last4,gstin_last4=excluded.gstin_last4,verification_status=case when not v_identity_changed and seller_compliance_profiles.verification_status='verified' then 'verified' else 'draft' end,rejection_reason=null,reviewed_at=case when not v_identity_changed and seller_compliance_profiles.verification_status='verified' then seller_compliance_profiles.reviewed_at else null end,reviewed_by=case when not v_identity_changed and seller_compliance_profiles.verification_status='verified' then seller_compliance_profiles.reviewed_by else null end,updated_at=now();

  if nullif(trim(coalesce(p_account_holder_name,'')),'') is not null or nullif(trim(coalesce(p_bank_name,'')),'') is not null or v_ifsc<>'' or v_account<>'' or v_old_p.seller_id is not null then
    if nullif(trim(coalesce(p_account_holder_name,'')),'') is null or nullif(trim(coalesce(p_bank_name,'')),'') is null then raise exception 'Complete payout account details'; end if;
    if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Invalid IFSC format'; end if;
    if coalesce(p_account_type,'') not in ('current','savings') then raise exception 'Invalid account type'; end if;
    if v_account<>'' and v_account !~ '^[0-9]{9,18}$' then raise exception 'Invalid bank account number'; end if;
    if v_old_p.seller_id is null and v_account='' then raise exception 'Bank account number is required'; end if;
    v_account_last4:=case when v_account<>'' then right(v_account,4) else v_old_p.account_number_last4 end;
    v_payout_changed:=v_old_p.seller_id is not null and (
      trim(coalesce(v_old_p.account_holder_name,''))<>trim(coalesce(p_account_holder_name,'')) or
      upper(trim(coalesce(v_old_p.ifsc,'')))<>v_ifsc or
      coalesce(v_old_p.account_type,'')<>coalesce(p_account_type,'') or
      (v_account<>'' and coalesce(v_old_p.account_number_last4,'')<>right(v_account,4))
    );
    if v_payout_changed and v_account='' then raise exception 'Re-enter the full bank account number when changing payout details'; end if;
    insert into public.seller_payout_profiles(seller_id,account_holder_name,bank_name,ifsc,account_number_last4,account_type,provider_name,provider_contact_ref,provider_fund_account_ref,provider_tokenized_at,provider_last_error,verification_status,rejection_reason,reviewed_at,reviewed_by,updated_at)
    values(v_seller,trim(p_account_holder_name),trim(p_bank_name),v_ifsc,v_account_last4,p_account_type,null,null,null,null,null,'draft',null,null,null,now())
    on conflict(seller_id) do update set account_holder_name=excluded.account_holder_name,bank_name=excluded.bank_name,ifsc=excluded.ifsc,account_number_last4=excluded.account_number_last4,account_type=excluded.account_type,
      provider_name=case when v_payout_changed then null else seller_payout_profiles.provider_name end,
      provider_contact_ref=case when v_payout_changed then null else seller_payout_profiles.provider_contact_ref end,
      provider_fund_account_ref=case when v_payout_changed then null else seller_payout_profiles.provider_fund_account_ref end,
      provider_tokenized_at=case when v_payout_changed then null else seller_payout_profiles.provider_tokenized_at end,
      provider_last_error=case when v_payout_changed then null else seller_payout_profiles.provider_last_error end,
      verification_status=case when not v_payout_changed and seller_payout_profiles.verification_status='verified' then 'verified' else 'draft' end,
      rejection_reason=null,
      reviewed_at=case when not v_payout_changed and seller_payout_profiles.verification_status='verified' then seller_payout_profiles.reviewed_at else null end,
      reviewed_by=case when not v_payout_changed and seller_payout_profiles.verification_status='verified' then seller_payout_profiles.reviewed_by else null end,
      updated_at=now();
  end if;
  return public.get_seller_finance_profile();
end $$;

grant execute on function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.get_seller_finance_profile() to authenticated;
-- END RECOVERED 20260924130042

-- BEGIN RECOVERED 20260924130143_admin_seller_payout_execution_guard
create or replace function public.admin_prepare_seller_payout(p_settlement_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_pay public.seller_payout_profiles%rowtype;
  v_key text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  if v_set.status='paid' then
    return jsonb_build_object('already_paid',true,'settlement_id',v_set.id,'provider_payout_ref',v_set.provider_payout_ref,'provider_status',v_set.provider_status,'provider_utr',v_set.provider_utr);
  end if;
  if v_set.status not in ('pending','failed','held','processing') then raise exception 'Settlement is not payable'; end if;
  if v_set.net_amount<=0 then raise exception 'Settlement amount must be positive'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=v_set.seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  select * into v_pay from public.seller_payout_profiles p where p.seller_id=v_set.seller_id;
  if v_pay.seller_id is null or v_pay.verification_status<>'verified' then raise exception 'Verified payout account required'; end if;
  if v_pay.provider_fund_account_ref is null then raise exception 'Provider fund account is not linked'; end if;
  v_key:=coalesce(v_set.payout_idempotency_key,'ff-settlement-'||v_set.id::text||'-v1');
  update public.seller_settlements
    set payout_idempotency_key=v_key,status='processing',provider_status=coalesce(provider_status,'queued'),updated_by=v_uid,updated_at=now()
    where id=v_set.id;
  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,'processing','Provider payout prepared',v_uid);
  return jsonb_build_object(
    'already_paid',false,'settlement_id',v_set.id,'seller_id',v_set.seller_id,'amount_paise',round(v_set.net_amount*100)::bigint,
    'currency',v_set.currency,'fund_account_id',v_pay.provider_fund_account_ref,'idempotency_key',v_key,
    'payout_mode',coalesce(v_set.payout_mode,'IMPS')
  );
end $$;

create or replace function public.admin_record_seller_payout_result(
  p_settlement_id bigint,p_provider_payout_ref text,p_provider_status text,p_provider_utr text,p_failure_reason text,p_provider_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_status text:=lower(trim(coalesce(p_provider_status,'')));
  v_final text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  v_final:=case when v_status in ('processed','paid') then 'paid' when v_status in ('rejected','failed','cancelled','reversed') then 'failed' else 'processing' end;
  update public.seller_settlements set
    provider_payout_ref=coalesce(nullif(trim(coalesce(p_provider_payout_ref,'')),''),provider_payout_ref),
    provider_status=nullif(v_status,''),provider_utr=nullif(trim(coalesce(p_provider_utr,'')),''),
    provider_status_details=coalesce(p_provider_details,'{}'::jsonb),provider_synced_at=now(),
    failure_reason=case when v_final='failed' then nullif(trim(coalesce(p_failure_reason,'')),'') else null end,
    status=v_final,paid_at=case when v_final='paid' then coalesce(paid_at,now()) else paid_at end,
    updated_by=v_uid,updated_at=now()
    where id=v_set.id;
  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,v_final,'Provider payout status: '||coalesce(nullif(v_status,''),'unknown'),v_uid);
  return (select jsonb_build_object('id',s.id,'status',s.status,'provider_status',s.provider_status,'provider_utr',s.provider_utr,'failure_reason',s.failure_reason,'paid_at',s.paid_at) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.admin_prepare_seller_payout(bigint) from public;
revoke all on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) from public;
grant execute on function public.admin_prepare_seller_payout(bigint) to authenticated;
grant execute on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) to authenticated;
-- END RECOVERED 20260924130143

-- BEGIN RECOVERED 20260924145713_seller_payout_webhook_reconciliation
create table if not exists public.seller_payout_webhook_events (
  id bigint generated by default as identity primary key,
  event_fingerprint text not null unique,
  event_type text not null,
  settlement_id bigint references public.seller_settlements(id) on delete set null,
  provider_payout_ref text,
  provider_status text,
  provider_utr text,
  status_details jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

alter table public.seller_payout_webhook_events enable row level security;
revoke all on public.seller_payout_webhook_events from public, anon, authenticated;
grant select, insert on public.seller_payout_webhook_events to service_role;

create or replace function public.service_record_seller_payout_webhook(
  p_event_fingerprint text,
  p_event_type text,
  p_settlement_id bigint,
  p_reference_id text,
  p_provider_payout_ref text,
  p_provider_status text,
  p_provider_utr text,
  p_failure_reason text,
  p_provider_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_set public.seller_settlements%rowtype;
  v_status text:=lower(trim(coalesce(p_provider_status,'')));
  v_final text;
  v_inserted bigint;
begin
  if nullif(trim(coalesce(p_event_fingerprint,'')),'') is null then raise exception 'Webhook fingerprint required'; end if;
  if nullif(trim(coalesce(p_event_type,'')),'') is null then raise exception 'Webhook event type required'; end if;
  if p_settlement_id is null or p_settlement_id < 1 then raise exception 'Invalid settlement id'; end if;
  if coalesce(p_reference_id,'') <> 'ff-settlement-'||p_settlement_id::text then raise exception 'Payout reference mismatch'; end if;

  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  if v_set.payout_idempotency_key is null then raise exception 'Settlement was not prepared for provider payout'; end if;
  if v_set.provider_payout_ref is not null and nullif(trim(coalesce(p_provider_payout_ref,'')),'') is not null and v_set.provider_payout_ref <> trim(p_provider_payout_ref) then
    raise exception 'Provider payout reference mismatch';
  end if;

  insert into public.seller_payout_webhook_events(event_fingerprint,event_type,settlement_id,provider_payout_ref,provider_status,provider_utr,status_details)
  values(trim(p_event_fingerprint),trim(p_event_type),p_settlement_id,nullif(trim(coalesce(p_provider_payout_ref,'')),''),nullif(v_status,''),nullif(trim(coalesce(p_provider_utr,'')),''),coalesce(p_provider_details,'{}'::jsonb))
  on conflict(event_fingerprint) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('ok',true,'duplicate',true,'settlement_id',p_settlement_id,'status',v_set.status,'provider_status',v_set.provider_status);
  end if;

  v_final:=case
    when v_status in ('processed','paid') then 'paid'
    when v_status in ('rejected','failed','cancelled','reversed') then 'failed'
    else 'processing'
  end;

  update public.seller_settlements set
    provider_payout_ref=coalesce(nullif(trim(coalesce(p_provider_payout_ref,'')),''),provider_payout_ref),
    provider_status=nullif(v_status,''),
    provider_utr=coalesce(nullif(trim(coalesce(p_provider_utr,'')),''),provider_utr),
    provider_status_details=coalesce(p_provider_details,'{}'::jsonb),
    provider_synced_at=now(),
    failure_reason=case when v_final='failed' then nullif(trim(coalesce(p_failure_reason,'')),'') else null end,
    status=v_final,
    paid_at=case when v_final='paid' then coalesce(paid_at,now()) when v_final='failed' then null else paid_at end,
    updated_at=now()
  where id=v_set.id;

  return (select jsonb_build_object(
    'ok',true,'duplicate',false,'settlement_id',s.id,'status',s.status,'provider_status',s.provider_status,
    'provider_utr',s.provider_utr,'failure_reason',s.failure_reason,'paid_at',s.paid_at
  ) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.service_record_seller_payout_webhook(text,text,bigint,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.service_record_seller_payout_webhook(text,text,bigint,text,text,text,text,text,jsonb) to service_role;

create or replace function public.admin_record_seller_payout_result(
  p_settlement_id bigint,p_provider_payout_ref text,p_provider_status text,p_provider_utr text,p_failure_reason text,p_provider_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_status text:=lower(trim(coalesce(p_provider_status,'')));
  v_final text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  v_final:=case when v_status in ('processed','paid') then 'paid' when v_status in ('rejected','failed','cancelled','reversed') then 'failed' else 'processing' end;
  update public.seller_settlements set
    provider_payout_ref=coalesce(nullif(trim(coalesce(p_provider_payout_ref,'')),''),provider_payout_ref),
    provider_status=nullif(v_status,''),provider_utr=nullif(trim(coalesce(p_provider_utr,'')),''),
    provider_status_details=coalesce(p_provider_details,'{}'::jsonb),provider_synced_at=now(),
    failure_reason=case when v_final='failed' then nullif(trim(coalesce(p_failure_reason,'')),'') else null end,
    status=v_final,
    paid_at=case when v_final='paid' then coalesce(paid_at,now()) when v_final='failed' then null else paid_at end,
    updated_by=v_uid,updated_at=now()
    where id=v_set.id;
  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,v_final,'Provider payout status: '||coalesce(nullif(v_status,''),'unknown'),v_uid);
  return (select jsonb_build_object('id',s.id,'status',s.status,'provider_status',s.provider_status,'provider_utr',s.provider_utr,'failure_reason',s.failure_reason,'paid_at',s.paid_at) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) from public;
grant execute on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) to authenticated;
-- END RECOVERED 20260924145713

-- BEGIN RECOVERED 20260924160134_manual_seller_payout_recording
alter table public.seller_settlements add column if not exists manual_payment_method text;
alter table public.seller_settlements add column if not exists manual_payment_reference text;
alter table public.seller_settlements add column if not exists manual_recorded_at timestamptz;

do $$ begin
  alter table public.seller_settlements add constraint seller_settlements_manual_payment_method_check check (manual_payment_method is null or manual_payment_method in ('bank_transfer','upi','neft','imps','rtgs','other'));
exception when duplicate_object then null; end $$;

create unique index if not exists seller_settlements_manual_payment_reference_uq
  on public.seller_settlements (lower(manual_payment_reference))
  where manual_payment_reference is not null;

create or replace function public.admin_record_manual_seller_payout(
  p_settlement_id bigint,
  p_payment_method text,
  p_payment_reference text,
  p_paid_at timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_method text:=lower(trim(coalesce(p_payment_method,'')));
  v_ref text:=nullif(trim(coalesce(p_payment_reference,'')),'');
  v_note text:=nullif(trim(coalesce(p_note,'')),'');
  v_paid_at timestamptz:=coalesce(p_paid_at,now());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if p_settlement_id is null or p_settlement_id < 1 then raise exception 'Invalid settlement ID'; end if;
  if v_method not in ('bank_transfer','upi','neft','imps','rtgs','other') then raise exception 'Invalid manual payment method'; end if;
  if v_ref is null or length(v_ref) < 4 or length(v_ref) > 120 then raise exception 'Valid UTR / payment reference is required'; end if;
  if v_paid_at > now() + interval '5 minutes' then raise exception 'Paid time cannot be in the future'; end if;

  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=v_set.seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=v_set.seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;

  if v_set.status='paid' then
    if lower(coalesce(v_set.manual_payment_reference,''))=lower(v_ref) and coalesce(v_set.manual_payment_method,'')=v_method then
      return jsonb_build_object('ok',true,'already_paid',true,'id',v_set.id,'status',v_set.status,'manual_payment_method',v_set.manual_payment_method,'manual_payment_reference',v_set.manual_payment_reference,'paid_at',v_set.paid_at);
    end if;
    raise exception 'Settlement is already paid with a different payment record';
  end if;

  if exists(select 1 from public.seller_settlements s where s.id<>v_set.id and lower(coalesce(s.manual_payment_reference,''))=lower(v_ref)) then
    raise exception 'This payment reference is already used by another settlement';
  end if;

  if v_set.provider_payout_ref is not null and lower(coalesce(v_set.provider_status,'')) not in ('failed','rejected','cancelled','reversed') then
    raise exception 'A provider payout already exists for this settlement';
  end if;
  if v_set.status not in ('pending','processing','failed','held') then raise exception 'Settlement is not payable'; end if;
  if v_set.net_amount <= 0 then raise exception 'Settlement amount must be positive'; end if;

  update public.seller_settlements set
    status='paid',
    paid_at=v_paid_at,
    manual_payment_method=v_method,
    manual_payment_reference=v_ref,
    manual_recorded_at=now(),
    failure_reason=null,
    updated_by=v_uid,
    updated_at=now()
  where id=v_set.id;

  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,'paid',coalesce(v_note,'Manual payout recorded')||' · '||upper(replace(v_method,'_',' '))||' · ref …'||right(v_ref,6),v_uid);

  return (select jsonb_build_object('ok',true,'already_paid',false,'id',s.id,'seller_id',s.seller_id,'net_amount',s.net_amount,'currency',s.currency,'status',s.status,'manual_payment_method',s.manual_payment_method,'manual_payment_reference',s.manual_payment_reference,'paid_at',s.paid_at,'manual_recorded_at',s.manual_recorded_at) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.admin_record_manual_seller_payout(bigint,text,text,timestamptz,text) from public,anon;
grant execute on function public.admin_record_manual_seller_payout(bigint,text,text,timestamptz,text) to authenticated;

create or replace function public.admin_upsert_seller_settlement(p_seller_id uuid,p_settlement_id bigint,p_period_start date,p_period_end date,p_gross_amount numeric,p_fees_amount numeric,p_refunds_amount numeric,p_status text,p_provider_payout_ref text default null,p_failure_reason text default null,p_note text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uid uuid:=auth.uid();v_status text:=lower(trim(coalesce(p_status,'')));v_ref text:=nullif(trim(coalesce(p_provider_payout_ref,'')),'');v_failure text:=nullif(trim(coalesce(p_failure_reason,'')),'');v_note text:=nullif(trim(coalesce(p_note,'')),'');v_id bigint;v_old_status text;v_net numeric(14,2);v_now timestamptz:=now();
begin
 if v_uid is null then raise exception 'Authentication required'; end if;if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then raise exception 'Seller not found'; end if;if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=p_seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=p_seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Invalid settlement period'; end if;if coalesce(p_gross_amount,-1)<0 or coalesce(p_fees_amount,-1)<0 or coalesce(p_refunds_amount,-1)<0 then raise exception 'Settlement amounts must be non-negative'; end if;v_net:=round((p_gross_amount-p_fees_amount-p_refunds_amount)::numeric,2);if v_net<0 then raise exception 'Settlement net amount cannot be negative'; end if;if v_status not in ('pending','processing','failed','held') then raise exception 'Invalid settlement status. Use manual payout recording to mark a settlement paid.'; end if;if v_status='failed' and v_failure is null then raise exception 'Failure reason is required'; end if;
 if p_settlement_id is null then insert into public.seller_settlements(seller_id,period_start,period_end,gross_amount,fees_amount,refunds_amount,net_amount,currency,status,provider_payout_ref,failure_reason,paid_at,created_by,updated_by,created_at,updated_at) values(p_seller_id,p_period_start,p_period_end,round(p_gross_amount,2),round(p_fees_amount,2),round(p_refunds_amount,2),v_net,'INR',v_status,v_ref,case when v_status='failed' then v_failure else null end,null,v_uid,v_uid,v_now,v_now) returning id into v_id;else select status into v_old_status from public.seller_settlements where id=p_settlement_id and seller_id=p_seller_id for update;if v_old_status is null then raise exception 'Settlement not found'; end if;if v_old_status='paid' then raise exception 'Paid settlements are immutable'; end if;update public.seller_settlements set period_start=p_period_start,period_end=p_period_end,gross_amount=round(p_gross_amount,2),fees_amount=round(p_fees_amount,2),refunds_amount=round(p_refunds_amount,2),net_amount=v_net,status=v_status,provider_payout_ref=v_ref,failure_reason=case when v_status='failed' then v_failure else null end,paid_at=null,updated_by=v_uid,updated_at=v_now where id=p_settlement_id and seller_id=p_seller_id returning id into v_id;end if;
 insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id) values(v_id,p_seller_id,v_old_status,v_status,v_note,v_uid);return(select jsonb_build_object('id',s.id,'seller_id',s.seller_id,'period_start',s.period_start,'period_end',s.period_end,'gross_amount',s.gross_amount,'fees_amount',s.fees_amount,'refunds_amount',s.refunds_amount,'net_amount',s.net_amount,'currency',s.currency,'status',s.status,'failure_reason',s.failure_reason,'paid_at',s.paid_at,'created_at',s.created_at,'updated_at',s.updated_at) from public.seller_settlements s where s.id=v_id);
end $$;

create or replace function public.admin_list_seller_finance_reviews(p_status text default null,p_search text default null,p_limit integer default 100,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uid uuid:=auth.uid();v_status text:=nullif(trim(coalesce(p_status,'')),'');v_search text:=nullif(trim(coalesce(p_search,'')),'');v_limit integer:=least(greatest(coalesce(p_limit,100),1),200);v_offset integer:=greatest(coalesce(p_offset,0),0);v_result jsonb;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
 select coalesce(jsonb_agg(item order by submitted_sort asc,created_sort desc),'[]'::jsonb) into v_result from (
  select jsonb_build_object('seller_id',s.user_id,'seller_code',s.seller_code,'store_name',s.store_name,'seller_type',s.seller_type,'seller_status',s.status,'email',u.email,'phone',s.phone,
   'compliance',case when c.seller_id is null then '{}'::jsonb else jsonb_build_object('legal_name',c.legal_name,'trade_name',c.trade_name,'entity_type',c.entity_type,'primary_category',c.primary_category,'gst_registered',c.gst_registered,'pan_last4',c.pan_last4,'gstin_last4',c.gstin_last4,'verification_status',c.verification_status,'rejection_reason',c.rejection_reason,'submitted_at',c.submitted_at,'reviewed_at',c.reviewed_at,'updated_at',c.updated_at) end,
   'payout',case when pp.seller_id is null then '{}'::jsonb else jsonb_build_object('account_holder_name',pp.account_holder_name,'bank_name',pp.bank_name,'ifsc',pp.ifsc,'account_number_last4',pp.account_number_last4,'account_type',pp.account_type,'verification_status',pp.verification_status,'rejection_reason',pp.rejection_reason,'reviewed_at',pp.reviewed_at,'updated_at',pp.updated_at) end,
   'pickup_locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,'contact_name',l.contact_name,'phone',l.phone,'line1',l.line1,'line2',l.line2,'city',l.city,'state',l.state,'pincode',l.pincode,'landmark',l.landmark,'is_default',l.is_default,'is_active',l.is_active) order by l.is_default desc,l.updated_at desc) from public.seller_pickup_locations l where l.seller_id=s.user_id and l.is_active),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'period_start',st.period_start,'period_end',st.period_end,'gross_amount',st.gross_amount,'fees_amount',st.fees_amount,'refunds_amount',st.refunds_amount,'net_amount',st.net_amount,'currency',st.currency,'status',st.status,'failure_reason',st.failure_reason,'paid_at',st.paid_at,'manual_payment_method',st.manual_payment_method,'manual_payment_reference',st.manual_payment_reference,'manual_recorded_at',st.manual_recorded_at,'provider_status',st.provider_status,'provider_utr',st.provider_utr,'created_at',st.created_at,'updated_at',st.updated_at) order by st.period_end desc,st.id desc) from public.seller_settlements st where st.seller_id=s.user_id),'[]'::jsonb),
   'recent_reviews',coalesce((select jsonb_agg(jsonb_build_object('scope',e.review_scope,'decision',e.decision,'reason',e.reason,'created_at',e.created_at) order by e.created_at desc) from (select * from public.seller_finance_review_events x where x.seller_id=s.user_id order by x.created_at desc limit 8)e),'[]'::jsonb)) item,
   coalesce(c.submitted_at,'9999-12-31'::timestamptz) submitted_sort,s.created_at created_sort
  from public.seller_profiles s join auth.users u on u.id=s.user_id left join public.seller_compliance_profiles c on c.seller_id=s.user_id left join public.seller_payout_profiles pp on pp.seller_id=s.user_id
  where (v_status is null or c.verification_status=v_status or pp.verification_status=v_status) and (v_search is null or s.seller_code ilike '%'||v_search||'%' or s.store_name ilike '%'||v_search||'%' or coalesce(u.email,'') ilike '%'||v_search||'%' or coalesce(c.legal_name,'') ilike '%'||v_search||'%')
  order by submitted_sort asc,created_sort desc limit v_limit offset v_offset
 )q;return v_result;
end $$;

revoke all on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) from public;
grant execute on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) to authenticated;
revoke all on function public.admin_list_seller_finance_reviews(text,text,integer,integer) from public;
grant execute on function public.admin_list_seller_finance_reviews(text,text,integer,integer) to authenticated;
-- END RECOVERED 20260924160134

-- BEGIN RECOVERED 20260924161034_manual_payout_double_reference_confirmation
create or replace function public.admin_record_manual_seller_payout(
  p_settlement_id bigint,
  p_payment_method text,
  p_payment_reference text,
  p_payment_reference_confirm text,
  p_paid_at timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_set public.seller_settlements%rowtype;
  v_method text:=lower(trim(coalesce(p_payment_method,'')));
  v_ref text:=nullif(trim(coalesce(p_payment_reference,'')),'');
  v_confirm_ref text:=nullif(trim(coalesce(p_payment_reference_confirm,'')),'');
  v_paid_at timestamptz:=coalesce(p_paid_at,now());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if p_settlement_id is null or p_settlement_id < 1 then raise exception 'Invalid settlement ID'; end if;
  if v_method not in ('neft','imps','rtgs') then raise exception 'Choose NEFT, IMPS or RTGS'; end if;
  if v_ref is null or length(v_ref) < 4 or length(v_ref) > 120 then raise exception 'Valid UTR / payment reference is required'; end if;
  if v_confirm_ref is null then raise exception 'Confirm UTR / payment reference is required'; end if;
  if v_ref <> v_confirm_ref then raise exception 'UTR / payment reference confirmation does not match'; end if;
  if v_paid_at > now() + interval '5 minutes' then raise exception 'Paid time cannot be in the future'; end if;

  select * into v_set from public.seller_settlements where id=p_settlement_id for update;
  if v_set.id is null then raise exception 'Settlement not found'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=v_set.seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=v_set.seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;

  if v_set.status='paid' then
    if lower(coalesce(v_set.manual_payment_reference,''))=lower(v_ref) and coalesce(v_set.manual_payment_method,'')=v_method then
      return jsonb_build_object('ok',true,'already_paid',true,'id',v_set.id,'status',v_set.status,'manual_payment_method',v_set.manual_payment_method,'manual_payment_reference',v_set.manual_payment_reference,'paid_at',v_set.paid_at);
    end if;
    raise exception 'Settlement is already paid with a different payment record';
  end if;

  if exists(select 1 from public.seller_settlements s where s.id<>v_set.id and lower(coalesce(s.manual_payment_reference,''))=lower(v_ref)) then
    raise exception 'This UTR / payment reference is already used by another settlement';
  end if;

  if v_set.provider_payout_ref is not null and lower(coalesce(v_set.provider_status,'')) not in ('failed','rejected','cancelled','reversed') then
    raise exception 'A provider payout already exists for this settlement';
  end if;
  if v_set.status not in ('pending','processing','failed','held') then raise exception 'Settlement is not payable'; end if;
  if v_set.net_amount <= 0 then raise exception 'Settlement amount must be positive'; end if;

  update public.seller_settlements set
    status='paid',
    paid_at=v_paid_at,
    manual_payment_method=v_method,
    manual_payment_reference=v_ref,
    manual_recorded_at=now(),
    failure_reason=null,
    updated_by=v_uid,
    updated_at=now()
  where id=v_set.id;

  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_set.id,v_set.seller_id,v_set.status,'paid','Manual payout confirmed · '||upper(v_method)||' · ref …'||right(v_ref,6),v_uid);

  return (select jsonb_build_object('ok',true,'already_paid',false,'id',s.id,'seller_id',s.seller_id,'net_amount',s.net_amount,'currency',s.currency,'status',s.status,'manual_payment_method',s.manual_payment_method,'manual_payment_reference',s.manual_payment_reference,'paid_at',s.paid_at,'manual_recorded_at',s.manual_recorded_at) from public.seller_settlements s where s.id=v_set.id);
end $$;

revoke all on function public.admin_record_manual_seller_payout(bigint,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.admin_record_manual_seller_payout(bigint,text,text,text,timestamptz,text) to authenticated;
revoke execute on function public.admin_record_manual_seller_payout(bigint,text,text,timestamptz,text) from authenticated;
-- END RECOVERED 20260924161034

-- BEGIN RECOVERED 20260924162617_seller_settlement_deduction_breakdown
alter table public.seller_settlements add column if not exists platform_commission_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists commission_gst_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists payment_fee_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists shipping_deduction_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists return_deduction_amount numeric(14,2) not null default 0;
alter table public.seller_settlements add column if not exists other_deduction_amount numeric(14,2) not null default 0;

do $$ begin
  alter table public.seller_settlements add constraint seller_settlements_deduction_breakdown_nonnegative check (
    platform_commission_amount >= 0 and commission_gst_amount >= 0 and payment_fee_amount >= 0 and shipping_deduction_amount >= 0 and return_deduction_amount >= 0 and other_deduction_amount >= 0
  );
exception when duplicate_object then null; end $$;

update public.seller_settlements
set other_deduction_amount = fees_amount
where fees_amount > 0
  and platform_commission_amount = 0
  and commission_gst_amount = 0
  and payment_fee_amount = 0
  and shipping_deduction_amount = 0
  and return_deduction_amount = 0
  and other_deduction_amount = 0;

create or replace function public.admin_upsert_seller_settlement_breakdown(
  p_seller_id uuid,
  p_settlement_id bigint,
  p_period_start date,
  p_period_end date,
  p_gross_amount numeric,
  p_platform_commission_amount numeric default 0,
  p_commission_gst_amount numeric default 0,
  p_payment_fee_amount numeric default 0,
  p_shipping_deduction_amount numeric default 0,
  p_return_deduction_amount numeric default 0,
  p_other_deduction_amount numeric default 0,
  p_refunds_amount numeric default 0,
  p_status text default 'pending',
  p_provider_payout_ref text default null,
  p_failure_reason text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_uid uuid:=auth.uid();
  v_status text:=lower(trim(coalesce(p_status,'')));
  v_ref text:=nullif(trim(coalesce(p_provider_payout_ref,'')),'');
  v_failure text:=nullif(trim(coalesce(p_failure_reason,'')),'');
  v_note text:=nullif(trim(coalesce(p_note,'')),'');
  v_id bigint;
  v_old_status text;
  v_existing_provider_ref text;
  v_existing_provider_status text;
  v_fees numeric(14,2);
  v_net numeric(14,2);
  v_now timestamptz:=now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.seller_profiles s where s.user_id=p_seller_id) then raise exception 'Seller not found'; end if;
  if not exists(select 1 from public.seller_compliance_profiles c where c.seller_id=p_seller_id and c.verification_status='verified') then raise exception 'Verified seller KYC required'; end if;
  if not exists(select 1 from public.seller_payout_profiles p where p.seller_id=p_seller_id and p.verification_status='verified') then raise exception 'Verified payout account required'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'Invalid settlement period'; end if;
  if coalesce(p_gross_amount,-1) < 0
     or coalesce(p_platform_commission_amount,-1) < 0
     or coalesce(p_commission_gst_amount,-1) < 0
     or coalesce(p_payment_fee_amount,-1) < 0
     or coalesce(p_shipping_deduction_amount,-1) < 0
     or coalesce(p_return_deduction_amount,-1) < 0
     or coalesce(p_other_deduction_amount,-1) < 0
     or coalesce(p_refunds_amount,-1) < 0 then
    raise exception 'Settlement amounts must be non-negative';
  end if;

  v_fees:=round((coalesce(p_platform_commission_amount,0)+coalesce(p_commission_gst_amount,0)+coalesce(p_payment_fee_amount,0)+coalesce(p_shipping_deduction_amount,0)+coalesce(p_return_deduction_amount,0)+coalesce(p_other_deduction_amount,0))::numeric,2);
  v_net:=round((p_gross_amount-v_fees-p_refunds_amount)::numeric,2);
  if v_net < 0 then raise exception 'Settlement net amount cannot be negative'; end if;
  if v_status not in ('pending','processing','failed','held') then raise exception 'Invalid settlement status. Use manual payout recording to mark a settlement paid.'; end if;
  if v_status='failed' and v_failure is null then raise exception 'Failure reason is required'; end if;

  if p_settlement_id is null then
    insert into public.seller_settlements(
      seller_id,period_start,period_end,gross_amount,
      platform_commission_amount,commission_gst_amount,payment_fee_amount,shipping_deduction_amount,return_deduction_amount,other_deduction_amount,
      fees_amount,refunds_amount,net_amount,currency,status,provider_payout_ref,failure_reason,paid_at,created_by,updated_by,created_at,updated_at
    ) values(
      p_seller_id,p_period_start,p_period_end,round(p_gross_amount,2),
      round(p_platform_commission_amount,2),round(p_commission_gst_amount,2),round(p_payment_fee_amount,2),round(p_shipping_deduction_amount,2),round(p_return_deduction_amount,2),round(p_other_deduction_amount,2),
      v_fees,round(p_refunds_amount,2),v_net,'INR',v_status,v_ref,case when v_status='failed' then v_failure else null end,null,v_uid,v_uid,v_now,v_now
    ) returning id into v_id;
  else
    select status,provider_payout_ref,provider_status into v_old_status,v_existing_provider_ref,v_existing_provider_status
    from public.seller_settlements where id=p_settlement_id and seller_id=p_seller_id for update;
    if v_old_status is null then raise exception 'Settlement not found'; end if;
    if v_old_status='paid' then raise exception 'Paid settlements are immutable'; end if;
    if v_existing_provider_ref is not null and lower(coalesce(v_existing_provider_status,'')) not in ('failed','rejected','cancelled','reversed') then raise exception 'Settlement with an active provider payout cannot be edited'; end if;

    update public.seller_settlements set
      period_start=p_period_start,period_end=p_period_end,gross_amount=round(p_gross_amount,2),
      platform_commission_amount=round(p_platform_commission_amount,2),commission_gst_amount=round(p_commission_gst_amount,2),payment_fee_amount=round(p_payment_fee_amount,2),shipping_deduction_amount=round(p_shipping_deduction_amount,2),return_deduction_amount=round(p_return_deduction_amount,2),other_deduction_amount=round(p_other_deduction_amount,2),
      fees_amount=v_fees,refunds_amount=round(p_refunds_amount,2),net_amount=v_net,status=v_status,provider_payout_ref=v_ref,
      failure_reason=case when v_status='failed' then v_failure else null end,paid_at=null,updated_by=v_uid,updated_at=v_now
    where id=p_settlement_id and seller_id=p_seller_id returning id into v_id;
  end if;

  insert into public.seller_settlement_events(settlement_id,seller_id,old_status,new_status,note,actor_id)
  values(v_id,p_seller_id,v_old_status,v_status,coalesce(v_note,'Settlement deductions updated')||' · total deductions ₹'||to_char(v_fees+round(p_refunds_amount,2),'FM9999999990.00'),v_uid);

  return (select to_jsonb(s) - 'provider_payout_ref' - 'payout_idempotency_key' - 'provider_status_details' - 'created_by' - 'updated_by'
          from public.seller_settlements s where s.id=v_id);
end $$;

revoke all on function public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text) from public,anon;
grant execute on function public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text) to authenticated;

create or replace function public.admin_upsert_seller_settlement(p_seller_id uuid,p_settlement_id bigint,p_period_start date,p_period_end date,p_gross_amount numeric,p_fees_amount numeric,p_refunds_amount numeric,p_status text,p_provider_payout_ref text default null,p_failure_reason text default null,p_note text default null) returns jsonb
language sql
security definer
set search_path=pg_catalog,public
as $$
  select public.admin_upsert_seller_settlement_breakdown(
    p_seller_id,p_settlement_id,p_period_start,p_period_end,p_gross_amount,
    0,0,0,0,0,p_fees_amount,p_refunds_amount,p_status,p_provider_payout_ref,p_failure_reason,p_note
  )
$$;

revoke all on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) from public,anon;
grant execute on function public.admin_upsert_seller_settlement(uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text) to authenticated;

create or replace function public.admin_list_seller_finance_reviews(p_status text default null,p_search text default null,p_limit integer default 100,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uid uuid:=auth.uid();v_status text:=nullif(trim(coalesce(p_status,'')),'');v_search text:=nullif(trim(coalesce(p_search,'')),'');v_limit integer:=least(greatest(coalesce(p_limit,100),1),200);v_offset integer:=greatest(coalesce(p_offset,0),0);v_result jsonb;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
 select coalesce(jsonb_agg(item order by submitted_sort asc,created_sort desc),'[]'::jsonb) into v_result from (
  select jsonb_build_object('seller_id',s.user_id,'seller_code',s.seller_code,'store_name',s.store_name,'seller_type',s.seller_type,'seller_status',s.status,'email',u.email,'phone',s.phone,
   'compliance',case when c.seller_id is null then '{}'::jsonb else jsonb_build_object('legal_name',c.legal_name,'trade_name',c.trade_name,'entity_type',c.entity_type,'primary_category',c.primary_category,'gst_registered',c.gst_registered,'pan_last4',c.pan_last4,'gstin_last4',c.gstin_last4,'verification_status',c.verification_status,'rejection_reason',c.rejection_reason,'submitted_at',c.submitted_at,'reviewed_at',c.reviewed_at,'updated_at',c.updated_at) end,
   'payout',case when pp.seller_id is null then '{}'::jsonb else jsonb_build_object('account_holder_name',pp.account_holder_name,'bank_name',pp.bank_name,'ifsc',pp.ifsc,'account_number_last4',pp.account_number_last4,'account_type',pp.account_type,'verification_status',pp.verification_status,'rejection_reason',pp.rejection_reason,'reviewed_at',pp.reviewed_at,'updated_at',pp.updated_at) end,
   'pickup_locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,'contact_name',l.contact_name,'phone',l.phone,'line1',l.line1,'line2',l.line2,'city',l.city,'state',l.state,'pincode',l.pincode,'landmark',l.landmark,'is_default',l.is_default,'is_active',l.is_active) order by l.is_default desc,l.updated_at desc) from public.seller_pickup_locations l where l.seller_id=s.user_id and l.is_active),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',st.id,'period_start',st.period_start,'period_end',st.period_end,'gross_amount',st.gross_amount,
      'platform_commission_amount',st.platform_commission_amount,'commission_gst_amount',st.commission_gst_amount,'payment_fee_amount',st.payment_fee_amount,'shipping_deduction_amount',st.shipping_deduction_amount,'return_deduction_amount',st.return_deduction_amount,'other_deduction_amount',st.other_deduction_amount,
      'fees_amount',st.fees_amount,'refunds_amount',st.refunds_amount,'net_amount',st.net_amount,'currency',st.currency,'status',st.status,'failure_reason',st.failure_reason,'paid_at',st.paid_at,
      'manual_payment_method',st.manual_payment_method,'manual_payment_reference',st.manual_payment_reference,'manual_recorded_at',st.manual_recorded_at,'provider_status',st.provider_status,'provider_utr',st.provider_utr,'created_at',st.created_at,'updated_at',st.updated_at
    ) order by st.period_end desc,st.id desc) from public.seller_settlements st where st.seller_id=s.user_id),'[]'::jsonb),
   'recent_reviews',coalesce((select jsonb_agg(jsonb_build_object('scope',e.review_scope,'decision',e.decision,'reason',e.reason,'created_at',e.created_at) order by e.created_at desc) from (select * from public.seller_finance_review_events x where x.seller_id=s.user_id order by x.created_at desc limit 8)e),'[]'::jsonb)) item,
   coalesce(c.submitted_at,'9999-12-31'::timestamptz) submitted_sort,s.created_at created_sort
  from public.seller_profiles s join auth.users u on u.id=s.user_id left join public.seller_compliance_profiles c on c.seller_id=s.user_id left join public.seller_payout_profiles pp on pp.seller_id=s.user_id
  where (v_status is null or c.verification_status=v_status or pp.verification_status=v_status) and (v_search is null or s.seller_code ilike '%'||v_search||'%' or s.store_name ilike '%'||v_search||'%' or coalesce(u.email,'') ilike '%'||v_search||'%' or coalesce(c.legal_name,'') ilike '%'||v_search||'%')
  order by submitted_sort asc,created_sort desc limit v_limit offset v_offset
 )q;return v_result;
end $$;

revoke all on function public.admin_list_seller_finance_reviews(text,text,integer,integer) from public;
grant execute on function public.admin_list_seller_finance_reviews(text,text,integer,integer) to authenticated;
-- END RECOVERED 20260924162617

-- BEGIN RECOVERED 20260924192044_owner_support_account_diagnostic
create or replace function public.owner_get_support_account_diagnostic(p_ticket_code text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_customer jsonb := '{}'::jsonb;
  v_seller jsonb := '{}'::jsonb;
  v_customer_signals jsonb := '[]'::jsonb;
  v_seller_signals jsonb := '[]'::jsonb;
begin
  if not public.is_owner_user(auth.uid()) then raise exception 'Owner access required'; end if;
  select * into v_ticket from public.support_tickets where upper(ticket_code)=upper(trim(p_ticket_code)) limit 1;
  if not found then raise exception 'Ticket not found'; end if;

  if v_ticket.customer_id is not null then
    select jsonb_build_object(
      'profile',jsonb_build_object('customer_id',p.id,'full_name',p.full_name,'phone',p.phone,'email',u.email,'email_confirmed',u.email_confirmed_at is not null,'last_sign_in_at',u.last_sign_in_at,'created_at',u.created_at),
      'orders',jsonb_build_object(
        'total',(select count(*) from public.orders o where o.user_id=p.id),
        'payment_failed',(select count(*) from public.orders o where o.user_id=p.id and o.status='payment_failed'),
        'cancelled',(select count(*) from public.orders o where o.user_id=p.id and (o.status in ('cancelled','cod_cancelled') or o.fulfillment_status='cancelled')),
        'open_fulfillment',(select count(*) from public.orders o where o.user_id=p.id and o.fulfillment_status not in ('delivered','cancelled')),
        'recent',coalesce((select jsonb_agg(x.obj order by x.created_at desc) from (select o.created_at,jsonb_build_object('display_order_id',o.display_order_id,'total_amount',o.total_amount,'status',o.status,'payment_method',o.payment_method,'fulfillment_status',o.fulfillment_status,'refund_status',o.refund_status,'created_at',o.created_at) obj from public.orders o where o.user_id=p.id order by o.created_at desc limit 10)x),'[]'::jsonb)
      ),
      'returns',jsonb_build_object('open',(select count(*) from public.return_requests r where r.user_id=p.id and r.status not in ('completed','rejected','cancelled')),'total',(select count(*) from public.return_requests r where r.user_id=p.id)),
      'support',jsonb_build_object('open',(select count(*) from public.support_tickets t where t.customer_id=p.id and t.status not in ('closed','resolved')),'reopened',coalesce((select sum(t.reopen_count) from public.support_tickets t where t.customer_id=p.id),0))
    ) into v_customer
    from public.profiles p join auth.users u on u.id=p.id where p.id=v_ticket.customer_id;

    if coalesce((v_customer#>>'{profile,email_confirmed}')::boolean,false)=false then v_customer_signals:=v_customer_signals||jsonb_build_array('Email not confirmed'); end if;
    if coalesce((v_customer#>>'{orders,payment_failed}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has failed payment order(s)'); end if;
    if coalesce((v_customer#>>'{orders,cancelled}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has cancelled order(s)'); end if;
    if coalesce((v_customer#>>'{returns,open}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has open return/exchange request(s)'); end if;
    if coalesce((v_customer#>>'{support,reopened}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has reopened support ticket(s)'); end if;
  end if;

  if v_ticket.seller_id is not null then
    select jsonb_build_object(
      'profile',jsonb_build_object('seller_id',s.user_id,'seller_code',s.seller_code,'store_name',s.store_name,'seller_type',s.seller_type,'phone',s.phone,'email',u.email,'status',s.status,'created_at',s.created_at),
      'kyc',coalesce((select jsonb_build_object('status',c.verification_status,'legal_name',c.legal_name,'pan_last4',c.pan_last4,'gstin_last4',c.gstin_last4,'rejection_reason',c.rejection_reason,'updated_at',c.updated_at) from public.seller_compliance_profiles c where c.seller_id=s.user_id),'{}'::jsonb),
      'payout',coalesce((select jsonb_build_object('status',pp.verification_status,'bank_name',pp.bank_name,'account_last4',pp.account_number_last4,'ifsc',pp.ifsc,'rejection_reason',pp.rejection_reason,'updated_at',pp.updated_at) from public.seller_payout_profiles pp where pp.seller_id=s.user_id),'{}'::jsonb),
      'pickup',jsonb_build_object('active_count',(select count(*) from public.seller_pickup_locations l where l.seller_id=s.user_id and l.is_active),'default_count',(select count(*) from public.seller_pickup_locations l where l.seller_id=s.user_id and l.is_active and l.is_default)),
      'products',jsonb_build_object('pending',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='pending'),'rejected',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='rejected'),'approved',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='approved')),
      'settlements',jsonb_build_object('pending',(select count(*) from public.seller_settlements st where st.seller_id=s.user_id and st.status in ('pending','processing','held')),'failed',(select count(*) from public.seller_settlements st where st.seller_id=s.user_id and st.status='failed'),'recent',coalesce((select jsonb_agg(x.obj order by x.id desc) from (select st.id,jsonb_build_object('id',st.id,'period_start',st.period_start,'period_end',st.period_end,'net_amount',st.net_amount,'status',st.status,'failure_reason',st.failure_reason,'manual_payment_method',st.manual_payment_method,'manual_payment_reference',st.manual_payment_reference,'paid_at',st.paid_at) obj from public.seller_settlements st where st.seller_id=s.user_id order by st.id desc limit 10)x),'[]'::jsonb)),
      'support',jsonb_build_object('open',(select count(*) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id and t.status not in ('closed','resolved')),'reopened',coalesce((select sum(t.reopen_count) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id),0))
    ) into v_seller
    from public.seller_profiles s join auth.users u on u.id=s.user_id where s.user_id=v_ticket.seller_id;

    if coalesce(v_seller#>>'{profile,status}','')<>'active' then v_seller_signals:=v_seller_signals||jsonb_build_array('Seller account is not active'); end if;
    if coalesce(v_seller#>>'{kyc,status}','draft')<>'verified' then v_seller_signals:=v_seller_signals||jsonb_build_array('KYC is not verified'); end if;
    if coalesce(v_seller#>>'{payout,status}','draft')<>'verified' then v_seller_signals:=v_seller_signals||jsonb_build_array('Payout account is not verified'); end if;
    if coalesce((v_seller#>>'{pickup,active_count}')::int,0)=0 then v_seller_signals:=v_seller_signals||jsonb_build_array('No active pickup location'); end if;
    if coalesce((v_seller#>>'{products,rejected}')::int,0)>0 then v_seller_signals:=v_seller_signals||jsonb_build_array('Has rejected product submission(s)'); end if;
    if coalesce((v_seller#>>'{settlements,failed}')::int,0)>0 then v_seller_signals:=v_seller_signals||jsonb_build_array('Has failed settlement(s)'); end if;
    if coalesce((v_seller#>>'{settlements,pending}')::int,0)>0 then v_seller_signals:=v_seller_signals||jsonb_build_array('Has pending/held settlement(s)'); end if;
  end if;

  return jsonb_build_object(
    'ticket',jsonb_build_object('ticket_code',v_ticket.ticket_code,'channel',v_ticket.channel,'status',v_ticket.status,'priority',v_ticket.priority,'issue_type',v_ticket.issue_type,'subject',v_ticket.subject,'order_id',v_ticket.order_id,'created_at',v_ticket.created_at,'updated_at',v_ticket.updated_at),
    'customer',v_customer,
    'customer_signals',v_customer_signals,
    'seller',v_seller,
    'seller_signals',v_seller_signals,
    'read_only',true
  );
end $$;
revoke all on function public.owner_get_support_account_diagnostic(text) from public,anon;
grant execute on function public.owner_get_support_account_diagnostic(text) to authenticated;
-- END RECOVERED 20260924192044

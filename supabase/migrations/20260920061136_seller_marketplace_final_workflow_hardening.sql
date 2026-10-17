-- Recovery bundle reconstructed from production supabase_migrations.schema_migrations.
-- It replays the lost 20260920061136..20260920125652 migrations in their original order.

-- BEGIN RECOVERED 20260920061136_seller_marketplace_final_workflow_hardening
alter table public.seller_product_submissions drop constraint if exists seller_product_submissions_status_check;
alter table public.seller_product_submissions add constraint seller_product_submissions_status_check check (status = any (array['pending'::text,'approved'::text,'rejected'::text,'withdrawn'::text]));

drop policy if exists product_bulk_tiers_public_read on public.product_bulk_tiers;
drop policy if exists product_bulk_tiers_anon_active_read on public.product_bulk_tiers;
drop policy if exists product_bulk_tiers_authenticated_active_or_admin_read on public.product_bulk_tiers;
create policy product_bulk_tiers_anon_active_read on public.product_bulk_tiers for select to anon using (
  exists (select 1 from public.products p where p.id = product_bulk_tiers.product_id and p.is_active = true)
);
create policy product_bulk_tiers_authenticated_active_or_admin_read on public.product_bulk_tiers for select to authenticated using (
  exists (select 1 from public.products p where p.id = product_bulk_tiers.product_id and p.is_active = true)
  or exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_admin = true)
);

create or replace function public.submit_seller_product(
  p_submission_id bigint,
  p_sku text,
  p_name text,
  p_category text,
  p_price numeric,
  p_mrp numeric,
  p_gst_rate numeric,
  p_description text,
  p_image_url text,
  p_brand text,
  p_country_origin text,
  p_hsn text,
  p_stock integer,
  p_bulk_enabled boolean,
  p_bulk_min_qty integer,
  p_bulk_price numeric,
  p_submission_payload jsonb default '{}'::jsonb
) returns public.seller_product_submissions
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_row public.seller_product_submissions;
  v_profile public.seller_profiles;
  v_payload jsonb := coalesce(p_submission_payload,'{}'::jsonb);
  v_variants jsonb;
  v_variant jsonb;
  v_variant_sku text;
  v_variant_stock integer;
  v_variant_price numeric;
  v_stock_total bigint := 0;
  v_seen_skus text[] := array[]::text[];
  v_low_stock_text text;
  v_images jsonb;
  v_image jsonb;
  v_image_text text;
  v_existing public.seller_product_submissions;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.seller_profiles where user_id=v_uid and status='active';
  if not found then raise exception 'Active seller profile required'; end if;

  if jsonb_typeof(v_payload) <> 'object' then raise exception 'Product metadata must be an object'; end if;
  if trim(coalesce(p_sku,''))='' or char_length(trim(p_sku))>60 then raise exception 'SKU is required and must be 60 characters or fewer'; end if;
  if trim(coalesce(p_name,''))='' or char_length(trim(p_name))>160 then raise exception 'Product name is required and must be 160 characters or fewer'; end if;
  if char_length(coalesce(p_category,''))>100 then raise exception 'Category is too long'; end if;
  if char_length(coalesce(p_description,''))>5000 then raise exception 'Description is too long'; end if;
  if char_length(coalesce(p_brand,''))>80 or trim(coalesce(p_brand,''))='' then raise exception 'Brand is required and must be 80 characters or fewer'; end if;
  if char_length(coalesce(p_country_origin,''))>80 or trim(coalesce(p_country_origin,''))='' then raise exception 'Country of origin is required'; end if;
  if p_hsn is not null and trim(p_hsn)<>'' and trim(p_hsn) !~ '^[0-9]{4,8}$' then raise exception 'HSN must be 4 to 8 digits'; end if;
  if p_image_url is not null and trim(p_image_url)<>'' and trim(p_image_url) !~ '^https://[^[:space:]]+$' then raise exception 'Product image must use a public HTTPS URL'; end if;
  if p_price is null or p_price<=0 or p_price>100000000 then raise exception 'Price must be greater than zero and within allowed limits'; end if;
  if p_mrp is not null and (p_mrp<p_price or p_mrp>100000000) then raise exception 'MRP cannot be lower than price or exceed allowed limits'; end if;
  if coalesce(p_gst_rate,18)<0 or coalesce(p_gst_rate,18)>100 then raise exception 'Invalid GST rate'; end if;
  if coalesce(p_stock,0)<0 or coalesce(p_stock,0)>1000000 then raise exception 'Stock is outside allowed limits'; end if;
  if octet_length(v_payload::text)>65536 then raise exception 'Product metadata is too large'; end if;
  if char_length(coalesce(v_payload->>'modelCode',''))>60 then raise exception 'Model/style code is too long'; end if;

  v_low_stock_text := nullif(v_payload->>'lowStockThreshold','');
  if v_low_stock_text is not null then
    if v_low_stock_text !~ '^[0-9]+$' or v_low_stock_text::numeric > 1000000 then raise exception 'Low-stock threshold is invalid'; end if;
  end if;

  if v_payload ? 'additionalImages' then
    v_images := v_payload->'additionalImages';
    if jsonb_typeof(v_images) <> 'array' then raise exception 'Additional images must be an array'; end if;
    if jsonb_array_length(v_images)>5 then raise exception 'Maximum 5 additional images are allowed'; end if;
    for v_image in select value from jsonb_array_elements(v_images) loop
      if jsonb_typeof(v_image) <> 'string' then raise exception 'Additional image URLs must be strings'; end if;
      v_image_text := trim(v_image #>> '{}');
      if v_image_text !~ '^https://[^[:space:]]+$' then raise exception 'Additional images must use public HTTPS URLs'; end if;
    end loop;
  end if;

  v_variants := coalesce(v_payload->'variants','[]'::jsonb);
  if jsonb_typeof(v_variants)<>'array' then raise exception 'Variants payload must be an array'; end if;
  if jsonb_array_length(v_variants)>50 then raise exception 'Maximum 50 variants are allowed'; end if;
  for v_variant in select value from jsonb_array_elements(v_variants) loop
    if jsonb_typeof(v_variant) <> 'object' then raise exception 'Every variant must be an object'; end if;
    v_variant_sku := upper(trim(coalesce(v_variant->>'sku','')));
    if v_variant_sku='' or char_length(v_variant_sku)>60 then raise exception 'Every variant needs a SKU of 60 characters or fewer'; end if;
    if lower(v_variant_sku)=any(v_seen_skus) then raise exception 'Variant SKUs must be unique within a listing'; end if;
    v_seen_skus := array_append(v_seen_skus,lower(v_variant_sku));
    if coalesce(v_variant->>'stock','') !~ '^[0-9]+$' then raise exception 'Every variant stock must be a whole number'; end if;
    v_variant_stock := (v_variant->>'stock')::integer;
    if v_variant_stock>1000000 then raise exception 'Variant stock exceeds allowed limits'; end if;
    v_stock_total := v_stock_total + v_variant_stock;
    if v_stock_total>1000000 then raise exception 'Total variant stock exceeds allowed limits'; end if;
    if nullif(v_variant->>'priceOverride','') is not null then
      if (v_variant->>'priceOverride') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'Variant price override is invalid'; end if;
      v_variant_price := (v_variant->>'priceOverride')::numeric;
      if v_variant_price<=0 or v_variant_price>100000000 then raise exception 'Variant price override is outside allowed limits'; end if;
    end if;
    if char_length(coalesce(v_variant->>'title',''))>160 then raise exception 'Variant title is too long'; end if;
    if char_length(coalesce(v_variant->>'size',''))>80 then raise exception 'Variant size/option is too long'; end if;
    if char_length(coalesce(v_variant->>'color',''))>80 then raise exception 'Variant color/style is too long'; end if;
    if nullif(trim(coalesce(v_variant->>'image','')),'') is not null and trim(v_variant->>'image') !~ '^https://[^[:space:]]+$' then raise exception 'Variant images must use public HTTPS URLs'; end if;
  end loop;

  if coalesce(p_bulk_enabled,false) and (coalesce(p_bulk_min_qty,0)<2 or p_bulk_min_qty>100000 or p_bulk_price is null or p_bulk_price<=0 or p_bulk_price>p_price) then raise exception 'Invalid bulk pricing'; end if;
  if jsonb_array_length(v_variants)>0 then p_stock := v_stock_total::integer; end if;

  if p_submission_id is null then
    select * into v_existing from public.seller_product_submissions where seller_id=v_uid and sku=upper(trim(p_sku)) for update;
    if found then
      if v_existing.status <> 'withdrawn' then raise exception 'This seller SKU already exists'; end if;
      update public.seller_product_submissions set
        name=trim(p_name),category=nullif(trim(coalesce(p_category,'')),''),price=p_price,mrp=p_mrp,gst_rate=coalesce(p_gst_rate,18),description=nullif(trim(coalesce(p_description,'')),''),image_url=nullif(trim(coalesce(p_image_url,'')),''),brand=trim(p_brand),country_origin=trim(p_country_origin),hsn=nullif(trim(coalesce(p_hsn,'')),''),stock=coalesce(p_stock,0),bulk_enabled=coalesce(p_bulk_enabled,false),bulk_min_qty=case when coalesce(p_bulk_enabled,false) then p_bulk_min_qty else null end,bulk_price=case when coalesce(p_bulk_enabled,false) then p_bulk_price else null end,submission_payload=v_payload,status='pending',rejection_reason=null,reviewed_at=null,reviewed_by=null,submitted_at=now(),updated_at=now()
      where id=v_existing.id returning * into v_row;
      if v_row.approved_product_id is not null then update public.products set is_active=false,updated_at=now() where id=v_row.approved_product_id; end if;
    else
      insert into public.seller_product_submissions(seller_id,sku,name,category,price,mrp,gst_rate,description,image_url,brand,country_origin,hsn,stock,bulk_enabled,bulk_min_qty,bulk_price,submission_payload,status,rejection_reason,approved_product_id,reviewed_at,reviewed_by,submitted_at,updated_at)
      values(v_uid,upper(trim(p_sku)),trim(p_name),nullif(trim(coalesce(p_category,'')),''),p_price,p_mrp,coalesce(p_gst_rate,18),nullif(trim(coalesce(p_description,'')),''),nullif(trim(coalesce(p_image_url,'')),''),trim(p_brand),trim(p_country_origin),nullif(trim(coalesce(p_hsn,'')),''),coalesce(p_stock,0),coalesce(p_bulk_enabled,false),case when coalesce(p_bulk_enabled,false) then p_bulk_min_qty else null end,case when coalesce(p_bulk_enabled,false) then p_bulk_price else null end,v_payload,'pending',null,null,null,null,now(),now()) returning * into v_row;
    end if;
  else
    update public.seller_product_submissions set
      sku=upper(trim(p_sku)),name=trim(p_name),category=nullif(trim(coalesce(p_category,'')),''),price=p_price,mrp=p_mrp,gst_rate=coalesce(p_gst_rate,18),description=nullif(trim(coalesce(p_description,'')),''),image_url=nullif(trim(coalesce(p_image_url,'')),''),brand=trim(p_brand),country_origin=trim(p_country_origin),hsn=nullif(trim(coalesce(p_hsn,'')),''),stock=coalesce(p_stock,0),bulk_enabled=coalesce(p_bulk_enabled,false),bulk_min_qty=case when coalesce(p_bulk_enabled,false) then p_bulk_min_qty else null end,bulk_price=case when coalesce(p_bulk_enabled,false) then p_bulk_price else null end,submission_payload=v_payload,status='pending',rejection_reason=null,reviewed_at=null,reviewed_by=null,submitted_at=now(),updated_at=now()
    where id=p_submission_id and seller_id=v_uid returning * into v_row;
    if not found then raise exception 'Submission not found'; end if;
    if v_row.approved_product_id is not null then update public.products set is_active=false,updated_at=now() where id=v_row.approved_product_id; end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.withdraw_seller_product(p_submission_id bigint)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid; v_sub public.seller_product_submissions;
begin
  v_uid:=auth.uid(); if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_sub from public.seller_product_submissions where id=p_submission_id and seller_id=v_uid for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_sub.approved_product_id is not null then update public.products set is_active=false,updated_at=now() where id=v_sub.approved_product_id; end if;
  update public.seller_product_submissions set status='withdrawn',rejection_reason=null,updated_at=now() where id=p_submission_id and seller_id=v_uid;
  return true;
end;
$$;

create or replace function public.admin_review_seller_product(p_submission_id bigint,p_decision text,p_rejection_reason text default null)
returns public.seller_product_submissions
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_sub public.seller_product_submissions;
  v_product_id bigint;
  v_variants jsonb;
  v_variant jsonb;
  v_variant_id bigint;
  v_existing_product_id bigint;
  v_variant_stock integer;
  v_reserved integer;
  v_internal_sku text;
  v_low_stock integer;
begin
  v_uid:=auth.uid(); if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then raise exception 'Administrator access required'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;
  select * into v_sub from public.seller_product_submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_sub.status<>'pending' then raise exception 'Only pending submissions can be reviewed'; end if;

  if p_decision='reject' then
    if trim(coalesce(p_rejection_reason,''))='' then raise exception 'Rejection reason is required'; end if;
    if char_length(trim(p_rejection_reason))>2000 then raise exception 'Rejection reason is too long'; end if;
    if v_sub.approved_product_id is not null then update public.products set is_active=false,updated_at=now() where id=v_sub.approved_product_id; end if;
    update public.seller_product_submissions set status='rejected',rejection_reason=trim(p_rejection_reason),reviewed_at=now(),reviewed_by=v_uid,updated_at=now() where id=p_submission_id returning * into v_sub;
    return v_sub;
  end if;

  v_variants:=coalesce(v_sub.submission_payload->'variants','[]'::jsonb);
  v_low_stock:=greatest(0,coalesce(nullif(v_sub.submission_payload->>'lowStockThreshold','')::integer,0));

  if v_sub.approved_product_id is not null then
    v_product_id:=v_sub.approved_product_id;
    update public.products set is_active=false,name=v_sub.name,category=v_sub.category,price=v_sub.price,image_url=v_sub.image_url,description=v_sub.description,gst_rate=v_sub.gst_rate,bulk_enabled=v_sub.bulk_enabled,bulk_min_qty=v_sub.bulk_min_qty,has_variants=true,updated_at=now() where id=v_product_id;
  else
    insert into public.products(name,category,cost,price,rating,reviews,image_url,badge,description,is_active,gst_rate,bulk_enabled,bulk_min_qty,has_variants,updated_at)
    values(v_sub.name,v_sub.category,0,v_sub.price,0,0,v_sub.image_url,null,v_sub.description,false,v_sub.gst_rate,v_sub.bulk_enabled,v_sub.bulk_min_qty,true,now()) returning id into v_product_id;
  end if;

  delete from public.product_bulk_tiers where product_id=v_product_id;
  if v_sub.bulk_enabled and v_sub.bulk_min_qty is not null and v_sub.bulk_price is not null then
    insert into public.product_bulk_tiers(product_id,min_qty,unit_price,updated_at) values(v_product_id,v_sub.bulk_min_qty,v_sub.bulk_price,now());
  end if;

  update public.product_variants set is_active=false,updated_at=now() where product_id=v_product_id;

  if jsonb_typeof(v_variants)='array' and jsonb_array_length(v_variants)>0 then
    for v_variant in select value from jsonb_array_elements(v_variants) loop
      v_internal_sku:='S'||p_submission_id::text||'-'||upper(trim(v_variant->>'sku'));
      v_variant_stock:=(v_variant->>'stock')::integer;
      select id,product_id into v_variant_id,v_existing_product_id from public.product_variants where sku=v_internal_sku;
      if found then
        if v_existing_product_id<>v_product_id then raise exception 'Internal marketplace SKU collision'; end if;
        update public.product_variants set title=nullif(trim(coalesce(v_variant->>'title','')),''),size=nullif(trim(coalesce(v_variant->>'size','')),''),color=nullif(trim(coalesce(v_variant->>'color','')),''),price_override=case when nullif(v_variant->>'priceOverride','') is null then null else (v_variant->>'priceOverride')::numeric end,image_url=coalesce(nullif(trim(coalesce(v_variant->>'image','')),''),v_sub.image_url),is_active=true,updated_at=now() where id=v_variant_id;
      else
        insert into public.product_variants(product_id,sku,title,size,color,price_override,image_url,is_active,updated_at)
        values(v_product_id,v_internal_sku,nullif(trim(coalesce(v_variant->>'title','')),''),nullif(trim(coalesce(v_variant->>'size','')),''),nullif(trim(coalesce(v_variant->>'color','')),''),case when nullif(v_variant->>'priceOverride','') is null then null else (v_variant->>'priceOverride')::numeric end,coalesce(nullif(trim(coalesce(v_variant->>'image','')),''),v_sub.image_url),true,now()) returning id into v_variant_id;
      end if;
      select reserved into v_reserved from public.inventory_levels where variant_id=v_variant_id;
      if found then
        if v_variant_stock < v_reserved then raise exception 'Variant % stock cannot be lower than % reserved units', upper(trim(v_variant->>'sku')), v_reserved; end if;
        update public.inventory_levels set on_hand=v_variant_stock,reorder_level=v_low_stock,updated_at=now() where variant_id=v_variant_id;
      else
        insert into public.inventory_levels(variant_id,on_hand,reserved,reorder_level,updated_at) values(v_variant_id,v_variant_stock,0,v_low_stock,now());
      end if;
    end loop;
  else
    v_internal_sku:='S'||p_submission_id::text||'-'||upper(trim(v_sub.sku));
    v_variant_stock:=greatest(0,v_sub.stock);
    select id,product_id into v_variant_id,v_existing_product_id from public.product_variants where sku=v_internal_sku;
    if found then
      if v_existing_product_id<>v_product_id then raise exception 'Internal marketplace SKU collision'; end if;
      update public.product_variants set title='Default',size=null,color=null,price_override=null,image_url=v_sub.image_url,is_active=true,updated_at=now() where id=v_variant_id;
    else
      insert into public.product_variants(product_id,sku,title,size,color,price_override,image_url,is_active,updated_at)
      values(v_product_id,v_internal_sku,'Default',null,null,null,v_sub.image_url,true,now()) returning id into v_variant_id;
    end if;
    select reserved into v_reserved from public.inventory_levels where variant_id=v_variant_id;
    if found then
      if v_variant_stock < v_reserved then raise exception 'Stock cannot be lower than % reserved units', v_reserved; end if;
      update public.inventory_levels set on_hand=v_variant_stock,reorder_level=v_low_stock,updated_at=now() where variant_id=v_variant_id;
    else
      insert into public.inventory_levels(variant_id,on_hand,reserved,reorder_level,updated_at) values(v_variant_id,v_variant_stock,0,v_low_stock,now());
    end if;
  end if;

  if not exists(select 1 from public.product_variants v join public.inventory_levels i on i.variant_id=v.id where v.product_id=v_product_id and v.is_active=true and (i.on_hand-i.reserved)>0) then raise exception 'At least one active SKU must have available stock before approval'; end if;
  update public.products set is_active=true,updated_at=now() where id=v_product_id;
  update public.seller_product_submissions set status='approved',rejection_reason=null,approved_product_id=v_product_id,reviewed_at=now(),reviewed_by=v_uid,updated_at=now() where id=p_submission_id returning * into v_sub;
  return v_sub;
end;
$$;

revoke all on function public.register_seller_profile(text,text,text) from public,anon;
revoke all on function public.submit_seller_product(bigint,text,text,text,numeric,numeric,numeric,text,text,text,text,text,integer,boolean,integer,numeric,jsonb) from public,anon;
revoke all on function public.withdraw_seller_product(bigint) from public,anon;
revoke all on function public.admin_review_seller_product(bigint,text,text) from public,anon;
grant execute on function public.register_seller_profile(text,text,text) to authenticated,service_role;
grant execute on function public.submit_seller_product(bigint,text,text,text,numeric,numeric,numeric,text,text,text,text,text,integer,boolean,integer,numeric,jsonb) to authenticated,service_role;
grant execute on function public.withdraw_seller_product(bigint) to authenticated,service_role;
grant execute on function public.admin_review_seller_product(bigint,text,text) to authenticated,service_role;
-- END RECOVERED 20260920061136

-- BEGIN RECOVERED 20260920075320_admin_product_costs_rpc
create or replace function public.admin_list_product_costs()
returns table(id bigint, cost numeric)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ) then
    raise exception 'Administrator access required';
  end if;
  return query
  select p.id, p.cost from public.products p order by p.id asc;
end;
$$;
revoke all on function public.admin_list_product_costs() from public, anon;
grant execute on function public.admin_list_product_costs() to authenticated, service_role;
-- END RECOVERED 20260920075320

-- BEGIN RECOVERED 20260920091323_admin_portal_jwt_backend_wrappers
create or replace function public.admin_list_payment_exceptions()
returns table(
  id bigint,
  order_id bigint,
  exception_type text,
  source text,
  payment_ref text,
  order_status text,
  occurrence_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true
  ) then raise exception 'Administrator access required'; end if;
  return query
  select e.id,e.order_id,e.exception_type,e.source,
         case when coalesce(e.payment_id,'')='' then null else '••••'||right(e.payment_id,4) end,
         e.order_status,e.occurrence_count,e.first_seen_at,e.last_seen_at
  from public.payment_exceptions e
  where e.status='open'
  order by e.last_seen_at desc
  limit 100;
end;
$$;

create or replace function public.admin_resolve_payment_exception(
  p_exception_id bigint,
  p_resolution_code text,
  p_resolution_note text
)
returns table(exception_id bigint, order_id bigint, status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare e public.payment_exceptions%rowtype; v_admin uuid:=auth.uid();
begin
  if v_admin is null or not exists(select 1 from public.profiles p where p.id=v_admin and p.is_admin=true)
  then raise exception 'Administrator access required'; end if;
  select * into e from public.resolve_payment_exception(p_exception_id,v_admin,p_resolution_code,p_resolution_note);
  return query select e.id,e.order_id,e.status;
end;
$$;

create or replace function public.admin_complete_cod_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_admin uuid:=auth.uid(); begin
  if v_admin is null or not exists(select 1 from public.profiles p where p.id=v_admin and p.is_admin=true)
  then raise exception 'Administrator access required'; end if;
  perform public.complete_cod_order_service(p_order_id,v_admin);
end; $$;

create or replace function public.admin_cancel_cod_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_admin uuid:=auth.uid(); begin
  if v_admin is null or not exists(select 1 from public.profiles p where p.id=v_admin and p.is_admin=true)
  then raise exception 'Administrator access required'; end if;
  perform public.cancel_cod_order_service(p_order_id,v_admin);
end; $$;

create or replace function public.admin_reconcile_cancelled_order_resources(p_order_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_admin uuid:=auth.uid(); o public.orders%rowtype; begin
  if v_admin is null or not exists(select 1 from public.profiles p where p.id=v_admin and p.is_admin=true)
  then raise exception 'Administrator access required'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if coalesce(o.fulfillment_status,'')<>'cancelled' or coalesce(o.status,'') not in ('refund_initiated','refund_pending','refund_failed','refunded','cancelled','cod_cancelled')
  then raise exception 'Only cancelled orders in a recovery state can be reconciled'; end if;
  perform public.release_order_inventory(o.id);
  perform public.restock_cancelled_order_inventory(o.id);
  perform public.restore_cancelled_order_promotions(o.id,o.user_id);
end; $$;

create or replace function public.admin_checkout_readiness_snapshot()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_admin uuid:=auth.uid(); missing text[]; begin
  if v_admin is null or not exists(select 1 from public.profiles p where p.id=v_admin and p.is_admin=true)
  then raise exception 'Administrator access required'; end if;
  select coalesce(array_agg(x.name order by x.name),'{}'::text[]) into missing
  from (values
    ('reserve_order_promotions'),('reserve_order_inventory'),('release_order_inventory'),('release_order_promotions'),
    ('finalize_cod_order_inventory'),('finalize_zero_value_order_inventory'),('commit_order_inventory'),
    ('finalize_checkout_order'),('claim_prepaid_order_cancellation'),('restore_cancelled_order_promotions'),
    ('restock_cancelled_order_inventory'),('record_payment_exception')
  ) as x(name)
  where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=x.name);
  return jsonb_build_object(
    'active_products',(select count(*) from public.products where is_active=true),
    'orders_count',(select count(*) from public.orders),
    'active_variants',(select count(*) from public.product_variants where is_active=true),
    'inventory_rows',(select count(*) from public.inventory_levels),
    'delivery_address_ready',exists(select 1 from public.customer_addresses where user_id=v_admin limit 1),
    'checkout_rpcs_ready',cardinality(missing)=0,
    'missing_rpcs',to_jsonb(missing)
  );
end; $$;

revoke all on function public.admin_list_payment_exceptions() from public, anon;
revoke all on function public.admin_resolve_payment_exception(bigint,text,text) from public, anon;
revoke all on function public.admin_complete_cod_order(bigint) from public, anon;
revoke all on function public.admin_cancel_cod_order(bigint) from public, anon;
revoke all on function public.admin_reconcile_cancelled_order_resources(bigint) from public, anon;
revoke all on function public.admin_checkout_readiness_snapshot() from public, anon;
grant execute on function public.admin_list_payment_exceptions() to authenticated,service_role;
grant execute on function public.admin_resolve_payment_exception(bigint,text,text) to authenticated,service_role;
grant execute on function public.admin_complete_cod_order(bigint) to authenticated,service_role;
grant execute on function public.admin_cancel_cod_order(bigint) to authenticated,service_role;
grant execute on function public.admin_reconcile_cancelled_order_resources(bigint) to authenticated,service_role;
grant execute on function public.admin_checkout_readiness_snapshot() to authenticated,service_role;

grant select,insert,update on public.order_shipments to authenticated;
grant usage,select on sequence public.order_shipments_id_seq to authenticated;
drop policy if exists "Admins can manage order shipments" on public.order_shipments;
create policy "Admins can manage order shipments" on public.order_shipments
for all to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true))
with check (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin=true));
-- END RECOVERED 20260920091323

-- BEGIN RECOVERED 20260920114003_add_unified_customer_seller_support_tickets
CREATE TABLE public.support_tickets (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ticket_code text UNIQUE,
  channel text NOT NULL CHECK (channel IN ('customer_support','seller_support')),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id bigint REFERENCES public.orders(id) ON DELETE SET NULL,
  product_id bigint REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id bigint,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issue_type text NOT NULL CHECK (char_length(btrim(issue_type)) BETWEEN 2 AND 80),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 180),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_customer','waiting_admin','waiting_seller','closed','reopened')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  resolution_summary text,
  sla_due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  reopen_count integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  legacy_request_id bigint UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL default now(),
  CHECK ((channel='customer_support' AND seller_id IS NULL) OR (channel='seller_support' AND seller_id IS NOT NULL AND order_id IS NOT NULL AND product_id IS NOT NULL))
);

CREATE TABLE public.support_ticket_messages (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ticket_id bigint NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('customer','admin','seller','system')),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','whatsapp','system','legacy')),
  external_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, external_message_id)
);

CREATE INDEX support_tickets_customer_idx ON public.support_tickets(customer_id, created_at DESC);
CREATE INDEX support_tickets_seller_idx ON public.support_tickets(seller_id, created_at DESC) WHERE channel='seller_support';
CREATE INDEX support_tickets_order_product_idx ON public.support_tickets(order_id, product_id, created_at DESC);
CREATE INDEX support_tickets_status_sla_idx ON public.support_tickets(status, sla_due_at) WHERE status <> 'closed';
CREATE INDEX support_ticket_messages_ticket_idx ON public.support_ticket_messages(ticket_id, created_at, id);

CREATE OR REPLACE FUNCTION public.support_add_working_days(p_start timestamptz, p_days integer)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path='pg_catalog','public' AS $$
DECLARE v_result timestamptz := p_start; v_added integer := 0;
BEGIN
  IF p_days <= 0 THEN RETURN p_start; END IF;
  WHILE v_added < p_days LOOP
    v_result := v_result + interval '1 day';
    IF extract(isodow from v_result) < 6 THEN v_added := v_added + 1; END IF;
  END LOOP;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.support_set_ticket_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
BEGIN
  IF new.ticket_code IS NULL OR btrim(new.ticket_code)='' THEN
    new.ticket_code := 'FF-' || CASE WHEN new.channel='seller_support' THEN 'SEL' ELSE 'SUP' END || '-' || to_char(coalesce(new.created_at,now()),'YYYYMMDD') || '-' || lpad(new.id::text,6,'0');
  END IF;
  IF new.sla_due_at IS NULL THEN new.sla_due_at := public.support_add_working_days(coalesce(new.created_at,now()),3); END IF;
  new.updated_at := now();
  RETURN new;
END; $$;
CREATE TRIGGER support_ticket_defaults_trg BEFORE INSERT ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.support_set_ticket_defaults();

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_tickets_select_permitted ON public.support_tickets FOR SELECT TO authenticated USING (
  customer_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_admin=true)
  OR (channel='seller_support' AND seller_id=auth.uid() AND EXISTS (SELECT 1 FROM public.seller_profiles s WHERE s.user_id=auth.uid() AND s.status='active'))
);
CREATE POLICY support_messages_select_permitted ON public.support_ticket_messages FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id=support_ticket_messages.ticket_id
      AND (t.customer_id=auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_admin=true)
        OR (t.channel='seller_support' AND t.seller_id=auth.uid() AND EXISTS (SELECT 1 FROM public.seller_profiles s WHERE s.user_id=auth.uid() AND s.status='active')))
  )
);

REVOKE ALL ON public.support_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.support_ticket_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT SELECT ON public.support_ticket_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_channel text, p_order_id bigint, p_product_id bigint, p_variant_id bigint,
  p_issue_type text, p_subject text, p_message text
) RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE v_uid uuid:=auth.uid(); v_order public.orders; v_seller uuid; v_ticket public.support_tickets; v_existing public.support_tickets;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_channel NOT IN ('customer_support','seller_support') THEN RAISE EXCEPTION 'Invalid support channel'; END IF;
  IF char_length(btrim(coalesce(p_issue_type,''))) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Issue type is required'; END IF;
  IF char_length(btrim(coalesce(p_subject,''))) NOT BETWEEN 3 AND 180 THEN RAISE EXCEPTION 'Subject must be 3 to 180 characters'; END IF;
  IF char_length(btrim(coalesce(p_message,''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Message is required'; END IF;
  IF NOT public.consume_api_rate_limit(v_uid::text,'support_ticket_create',5,3600) THEN RAISE EXCEPTION 'Too many support tickets. Please wait before creating another ticket.'; END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND user_id=v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found for this customer'; END IF;
  END IF;

  IF p_channel='seller_support' THEN
    IF p_order_id IS NULL OR p_product_id IS NULL THEN RAISE EXCEPTION 'Seller support requires an order and purchased product'; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_order.items) x WHERE (x->>'id')::bigint=p_product_id AND (p_variant_id IS NULL OR nullif(x->>'variant_id','')::bigint=p_variant_id)) THEN
      RAISE EXCEPTION 'Selected product was not found in this order';
    END IF;
    SELECT s.seller_id INTO v_seller FROM public.seller_product_submissions s
      WHERE s.approved_product_id=p_product_id AND s.status='approved'
      ORDER BY s.reviewed_at DESC NULLS LAST, s.id DESC LIMIT 1;
    IF v_seller IS NULL THEN RAISE EXCEPTION 'This product is not linked to an active marketplace seller'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.seller_profiles sp WHERE sp.user_id=v_seller AND sp.status='active') THEN RAISE EXCEPTION 'Seller support is currently unavailable for this product'; END IF;
  END IF;

  SELECT * INTO v_existing FROM public.support_tickets t
   WHERE t.customer_id=v_uid AND t.channel=p_channel
     AND coalesce(t.order_id,0)=coalesce(p_order_id,0)
     AND coalesce(t.product_id,0)=coalesce(p_product_id,0)
     AND lower(t.issue_type)=lower(btrim(p_issue_type)) AND t.status<>'closed'
   ORDER BY t.created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_existing; END IF;

  INSERT INTO public.support_tickets(channel,customer_id,order_id,product_id,variant_id,seller_id,issue_type,subject,status)
  VALUES(p_channel,v_uid,p_order_id,p_product_id,p_variant_id,v_seller,btrim(p_issue_type),btrim(p_subject),CASE WHEN p_channel='seller_support' THEN 'waiting_seller' ELSE 'waiting_admin' END)
  RETURNING * INTO v_ticket;
  INSERT INTO public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  VALUES(v_ticket.id,v_uid,'customer',btrim(p_message),'web');
  RETURN v_ticket;
END; $$;

CREATE OR REPLACE FUNCTION public.send_support_ticket_message(p_ticket_id bigint,p_message text)
RETURNS public.support_ticket_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE v_uid uuid:=auth.uid(); v_ticket public.support_tickets; v_role text; v_row public.support_ticket_messages;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(btrim(coalesce(p_message,''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Message is required'; END IF;
  IF NOT public.consume_api_rate_limit(v_uid::text,'support_ticket_message',30,60) THEN RAISE EXCEPTION 'Too many support messages. Please wait a moment.'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF v_ticket.status='closed' THEN RAISE EXCEPTION 'This ticket is closed. Reopen it before replying.'; END IF;
  IF v_ticket.customer_id=v_uid THEN v_role:='customer';
  ELSIF v_ticket.channel='customer_support' AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_uid AND p.is_admin=true) THEN v_role:='admin';
  ELSIF v_ticket.channel='seller_support' AND v_ticket.seller_id=v_uid AND EXISTS(SELECT 1 FROM public.seller_profiles s WHERE s.user_id=v_uid AND s.status='active') THEN v_role:='seller';
  ELSE RAISE EXCEPTION 'You do not have permission to reply to this ticket'; END IF;
  INSERT INTO public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  VALUES(v_ticket.id,v_uid,v_role,btrim(p_message),'web') RETURNING * INTO v_row;
  UPDATE public.support_tickets SET status=CASE WHEN v_role='customer' THEN CASE WHEN channel='seller_support' THEN 'waiting_seller' ELSE 'waiting_admin' END ELSE 'waiting_customer' END,updated_at=now() WHERE id=v_ticket.id;
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.close_support_ticket(p_ticket_id bigint,p_resolution_summary text)
RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE v_uid uuid:=auth.uid(); v_ticket public.support_tickets; v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(btrim(coalesce(p_resolution_summary,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Resolution summary is required'; END IF;
  SELECT exists(SELECT 1 FROM public.profiles p WHERE p.id=v_uid AND p.is_admin=true) INTO v_is_admin;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF v_ticket.channel='customer_support' THEN
    IF NOT v_is_admin THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  ELSE
    IF NOT ((v_ticket.seller_id=v_uid AND EXISTS(SELECT 1 FROM public.seller_profiles s WHERE s.user_id=v_uid AND s.status='active')) OR v_is_admin) THEN RAISE EXCEPTION 'Seller or administrator access required'; END IF;
  END IF;
  UPDATE public.support_tickets SET status='closed',resolution_summary=btrim(p_resolution_summary),resolved_at=now(),closed_at=now(),updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
  INSERT INTO public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  VALUES(v_ticket.id,v_uid,CASE WHEN v_is_admin THEN 'admin' ELSE 'seller' END,'Ticket closed: '||btrim(p_resolution_summary),'system');
  RETURN v_ticket;
END; $$;

CREATE OR REPLACE FUNCTION public.reopen_support_ticket(p_ticket_id bigint,p_message text)
RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE v_uid uuid:=auth.uid(); v_ticket public.support_tickets;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(btrim(coalesce(p_message,''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Please explain why the issue is not resolved'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id AND customer_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF v_ticket.status<>'closed' THEN RAISE EXCEPTION 'Only closed tickets can be reopened'; END IF;
  IF v_ticket.channel='seller_support' AND (v_ticket.seller_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.seller_profiles s WHERE s.user_id=v_ticket.seller_id AND s.status='active')) THEN RAISE EXCEPTION 'Seller support is currently unavailable'; END IF;
  UPDATE public.support_tickets SET status=CASE WHEN channel='seller_support' THEN 'waiting_seller' ELSE 'waiting_admin' END,reopened_at=now(),reopen_count=reopen_count+1,closed_at=null,resolved_at=null,resolution_summary=null,sla_due_at=public.support_add_working_days(now(),3),updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
  INSERT INTO public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source) VALUES(v_ticket.id,v_uid,'customer',btrim(p_message),'web');
  RETURN v_ticket;
END; $$;

CREATE OR REPLACE FUNCTION public.ingest_seller_whatsapp_reply(p_ticket_code text,p_seller_phone text,p_message text,p_external_message_id text)
RETURNS public.support_ticket_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE v_seller uuid; v_ticket public.support_tickets; v_row public.support_ticket_messages;
BEGIN
  IF char_length(btrim(coalesce(p_message,''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Message is required'; END IF;
  SELECT sp.user_id INTO v_seller FROM public.seller_profiles sp WHERE regexp_replace(coalesce(sp.phone,''),'[^0-9]','','g')=regexp_replace(coalesce(p_seller_phone,''),'[^0-9]','','g') AND sp.status='active' LIMIT 1;
  IF v_seller IS NULL THEN RAISE EXCEPTION 'Seller phone is not linked to an active seller'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE ticket_code=p_ticket_code AND channel='seller_support' AND seller_id=v_seller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Seller ticket not found'; END IF;
  IF v_ticket.status='closed' THEN RAISE EXCEPTION 'Ticket is closed'; END IF;
  IF p_external_message_id IS NOT NULL THEN SELECT * INTO v_row FROM public.support_ticket_messages WHERE source='whatsapp' AND external_message_id=p_external_message_id LIMIT 1; IF FOUND THEN RETURN v_row; END IF; END IF;
  INSERT INTO public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source,external_message_id) VALUES(v_ticket.id,v_seller,'seller',btrim(p_message),'whatsapp',p_external_message_id) RETURNING * INTO v_row;
  UPDATE public.support_tickets SET status='waiting_customer',updated_at=now() WHERE id=v_ticket.id;
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_support_ticket_message(bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_support_ticket(bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_support_ticket(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_support_ticket_message(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_support_ticket(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_support_ticket(bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.ingest_seller_whatsapp_reply(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_seller_whatsapp_reply(text,text,text,text) TO service_role;

INSERT INTO public.support_tickets(channel,customer_id,order_id,issue_type,subject,status,legacy_request_id,created_at,updated_at)
SELECT 'customer_support',r.user_id,r.order_id,'legacy_support',left(CASE WHEN char_length(btrim(r.issue))<3 THEN 'Support: '||btrim(r.issue) ELSE btrim(r.issue) END,180),CASE WHEN r.status='pending' THEN 'waiting_admin' WHEN r.status='accepted' THEN 'waiting_customer' ELSE 'closed' END,r.id,r.created_at,r.updated_at
FROM public.customer_support_requests r WHERE r.user_id IS NOT NULL;
INSERT INTO public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source,created_at)
SELECT t.id,m.sender_user_id,CASE WHEN m.sender_type='admin' THEN 'admin' ELSE 'customer' END,m.message,'legacy',m.created_at
FROM public.customer_support_messages m JOIN public.support_tickets t ON t.legacy_request_id=m.request_id;
-- END RECOVERED 20260920114003

-- BEGIN RECOVERED 20260920122611_add_seller_support_identity_and_admin_whatsapp
create table if not exists public.support_contact_config (
  id smallint primary key default 1 check (id = 1),
  admin_whatsapp_e164 text not null check (admin_whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

alter table public.support_contact_config enable row level security;
revoke all on public.support_contact_config from anon, authenticated;
grant select, update on public.support_contact_config to authenticated;

drop policy if exists support_contact_config_select on public.support_contact_config;
create policy support_contact_config_select
on public.support_contact_config
for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  or exists (select 1 from public.seller_profiles s where s.user_id = auth.uid() and s.status = 'active')
);

drop policy if exists support_contact_config_admin_update on public.support_contact_config;
create policy support_contact_config_admin_update
on public.support_contact_config
for update to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

insert into public.support_contact_config (id, admin_whatsapp_e164)
values (1, '+918852976856')
on conflict (id) do update
set admin_whatsapp_e164 = excluded.admin_whatsapp_e164,
    updated_at = now();

create sequence if not exists public.seller_code_seq start with 1 increment by 1 no minvalue no maxvalue cache 1;

create or replace function public.generate_seller_code()
returns text
language sql
security definer
set search_path = pg_catalog, public
as $$
  select 'FF-SLR-' || lpad(nextval('public.seller_code_seq')::text, 6, '0')
$$;

revoke all on function public.generate_seller_code() from public, anon, authenticated;

alter table public.seller_profiles add column if not exists seller_code text;
update public.seller_profiles
set seller_code = public.generate_seller_code()
where seller_code is null;
alter table public.seller_profiles alter column seller_code set default public.generate_seller_code();
alter table public.seller_profiles alter column seller_code set not null;
create unique index if not exists seller_profiles_seller_code_uidx on public.seller_profiles (seller_code);

create or replace function public.get_seller_support_contact()
returns table (
  seller_id uuid,
  seller_code text,
  store_name text,
  seller_type text,
  registered_phone text,
  registered_email text,
  seller_status text,
  admin_whatsapp_e164 text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.seller_profiles s
    where s.user_id = v_uid and s.status = 'active'
  ) then
    raise exception 'Active seller profile required';
  end if;

  return query
  select
    s.user_id,
    s.seller_code,
    s.store_name,
    s.seller_type,
    s.phone,
    u.email::text,
    s.status,
    c.admin_whatsapp_e164
  from public.seller_profiles s
  join auth.users u on u.id = s.user_id
  cross join public.support_contact_config c
  where s.user_id = v_uid
    and s.status = 'active'
    and c.id = 1;
end;
$$;

revoke all on function public.get_seller_support_contact() from public, anon;
grant execute on function public.get_seller_support_contact() to authenticated;

create or replace function public.admin_get_seller_support_profile(p_seller_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_result jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.is_admin = true) then
    raise exception 'Administrator access required';
  end if;

  select jsonb_build_object(
    'seller_id', s.user_id,
    'seller_code', s.seller_code,
    'store_name', s.store_name,
    'seller_type', s.seller_type,
    'phone', s.phone,
    'email', u.email,
    'status', s.status,
    'created_at', s.created_at,
    'updated_at', s.updated_at,
    'submission_count', (select count(*) from public.seller_product_submissions x where x.seller_id = s.user_id),
    'pending_submissions', (select count(*) from public.seller_product_submissions x where x.seller_id = s.user_id and x.status = 'pending'),
    'approved_submissions', (select count(*) from public.seller_product_submissions x where x.seller_id = s.user_id and x.status = 'approved'),
    'rejected_submissions', (select count(*) from public.seller_product_submissions x where x.seller_id = s.user_id and x.status = 'rejected')
  )
  into v_result
  from public.seller_profiles s
  join auth.users u on u.id = s.user_id
  where upper(s.seller_code) = upper(trim(p_seller_code))
  limit 1;

  if v_result is null then
    raise exception 'Seller not found';
  end if;
  return v_result;
end;
$$;

revoke all on function public.admin_get_seller_support_profile(text) from public, anon, authenticated;
grant execute on function public.admin_get_seller_support_profile(text) to authenticated;
-- END RECOVERED 20260920122611

-- BEGIN RECOVERED 20260920122902_add_admin_all_sellers_directory
create or replace function public.admin_list_sellers(
  p_search text default null,
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  seller_id uuid,
  seller_code text,
  store_name text,
  seller_type text,
  phone text,
  email text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  submission_count bigint,
  pending_submissions bigint,
  approved_submissions bigint,
  rejected_submissions bigint,
  seller_ticket_count bigint,
  open_seller_tickets bigint,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_search text := nullif(trim(coalesce(p_search,'')), '');
  v_limit integer := least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer := greatest(coalesce(p_offset,0),0);
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;

  return query
  select
    s.user_id,
    s.seller_code,
    s.store_name,
    s.seller_type,
    s.phone,
    u.email::text,
    s.status,
    s.created_at,
    s.updated_at,
    (select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id),
    (select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='pending'),
    (select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='approved'),
    (select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='rejected'),
    (select count(*) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id),
    (select count(*) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id and t.status not in ('closed','resolved')),
    greatest(
      s.updated_at,
      coalesce((select max(x.updated_at) from public.seller_product_submissions x where x.seller_id=s.user_id), s.updated_at),
      coalesce((select max(t.updated_at) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id), s.updated_at)
    )
  from public.seller_profiles s
  join auth.users u on u.id=s.user_id
  where (nullif(trim(coalesce(p_status,'')),'') is null or s.status=trim(p_status))
    and (
      v_search is null
      or s.seller_code ilike '%'||v_search||'%'
      or s.store_name ilike '%'||v_search||'%'
      or coalesce(s.phone,'') ilike '%'||v_search||'%'
      or coalesce(u.email,'') ilike '%'||v_search||'%'
    )
  order by s.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_list_sellers(text,text,integer,integer) from public, anon;
grant execute on function public.admin_list_sellers(text,text,integer,integer) to authenticated;

create or replace function public.admin_get_seller_complete_profile(p_seller_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_seller_id uuid;
  v_result jsonb;
begin
  v_uid:=auth.uid();
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;

  select s.user_id into v_seller_id
  from public.seller_profiles s
  where upper(s.seller_code)=upper(trim(p_seller_code))
  limit 1;

  if v_seller_id is null then raise exception 'Seller not found'; end if;

  select jsonb_build_object(
    'seller', jsonb_build_object(
      'seller_id',s.user_id,
      'seller_code',s.seller_code,
      'store_name',s.store_name,
      'seller_type',s.seller_type,
      'phone',s.phone,
      'email',u.email,
      'status',s.status,
      'created_at',s.created_at,
      'updated_at',s.updated_at
    ),
    'products', jsonb_build_object(
      'total',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id),
      'pending',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='pending'),
      'approved',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='approved'),
      'rejected',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='rejected'),
      'withdrawn',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='withdrawn'),
      'last_updated_at',(select max(x.updated_at) from public.seller_product_submissions x where x.seller_id=s.user_id)
    ),
    'support', jsonb_build_object(
      'total',(select count(*) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id),
      'open',(select count(*) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id and t.status not in ('closed','resolved')),
      'closed',(select count(*) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id and t.status in ('closed','resolved')),
      'reopened',(select coalesce(sum(t.reopen_count),0) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id),
      'last_updated_at',(select max(t.updated_at) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id)
    )
  ) into v_result
  from public.seller_profiles s
  join auth.users u on u.id=s.user_id
  where s.user_id=v_seller_id;

  return v_result;
end;
$$;

revoke all on function public.admin_get_seller_complete_profile(text) from public, anon;
grant execute on function public.admin_get_seller_complete_profile(text) to authenticated;
-- END RECOVERED 20260920122902

-- BEGIN RECOVERED 20260920123119_add_admin_customer_directory_and_complete_profile
create or replace function public.admin_list_customers(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  full_name text,
  phone text,
  email text,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  order_count bigint,
  total_spend numeric,
  open_support_tickets bigint,
  return_request_count bigint,
  address_count bigint,
  is_business_customer boolean,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_search text := nullif(trim(coalesce(p_search,'')), '');
  v_digits text := regexp_replace(coalesce(p_search,''), '[^0-9]', '', 'g');
  v_limit integer := least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer := greatest(coalesce(p_offset,0),0);
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.phone,
    u.email::text,
    p.created_at,
    p.updated_at,
    u.last_sign_in_at,
    (select count(*) from public.orders o where o.user_id=p.id),
    coalesce((select sum(o.total_amount) from public.orders o where o.user_id=p.id and o.status in ('paid','cod_pending','cod_collected','refunded','refund_initiated','refund_pending')),0),
    (select count(*) from public.support_tickets t where t.customer_id=p.id and t.status not in ('closed','resolved')),
    (select count(*) from public.return_requests r where r.user_id=p.id),
    (select count(*) from public.customer_addresses a where a.user_id=p.id),
    exists(select 1 from public.business_profiles b where b.user_id=p.id),
    greatest(
      p.updated_at,
      coalesce((select max(o.created_at) from public.orders o where o.user_id=p.id), p.updated_at),
      coalesce((select max(t.updated_at) from public.support_tickets t where t.customer_id=p.id), p.updated_at),
      coalesce((select max(r.updated_at) from public.return_requests r where r.user_id=p.id), p.updated_at)
    )
  from public.profiles p
  join auth.users u on u.id=p.id
  where coalesce(p.is_admin,false)=false
    and (
      v_search is null
      or coalesce(p.full_name,'') ilike '%'||v_search||'%'
      or coalesce(u.email,'') ilike '%'||v_search||'%'
      or (v_digits<>'' and regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') like '%'||v_digits||'%')
      or exists (
        select 1 from public.customer_addresses a
        where a.user_id=p.id
          and v_digits<>''
          and regexp_replace(coalesce(a.phone,''),'[^0-9]','','g') like '%'||v_digits||'%'
      )
      or exists (
        select 1 from public.orders o
        where o.user_id=p.id
          and (
            coalesce(o.customer_email,'') ilike '%'||v_search||'%'
            or (v_digits<>'' and regexp_replace(coalesce(o.customer_phone,''),'[^0-9]','','g') like '%'||v_digits||'%')
          )
      )
    )
  order by p.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_list_customers(text,integer,integer) from public, anon;
grant execute on function public.admin_list_customers(text,integer,integer) to authenticated;

create or replace function public.admin_get_customer_complete_profile(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_result jsonb;
begin
  v_uid:=auth.uid();
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_uid and p.is_admin=true) then
    raise exception 'Administrator access required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id=p_customer_id and coalesce(p.is_admin,false)=false
  ) then
    raise exception 'Customer not found';
  end if;

  select jsonb_build_object(
    'customer', jsonb_build_object(
      'customer_id',p.id,
      'full_name',p.full_name,
      'phone',p.phone,
      'email',u.email,
      'email_confirmed_at',u.email_confirmed_at,
      'phone_confirmed_at',u.phone_confirmed_at,
      'account_created_at',u.created_at,
      'profile_created_at',p.created_at,
      'profile_updated_at',p.updated_at,
      'last_sign_in_at',u.last_sign_in_at
    ),
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'label',a.label,
        'full_name',a.full_name,
        'phone',a.phone,
        'address_line1',a.address_line1,
        'address_line2',a.address_line2,
        'city',a.city,
        'state',a.state,
        'postal_code',a.postal_code,
        'country',a.country,
        'is_default',a.is_default,
        'created_at',a.created_at,
        'updated_at',a.updated_at
      ) order by a.is_default desc, a.created_at desc)
      from public.customer_addresses a where a.user_id=p.id
    ),'[]'::jsonb),
    'business_profile', (
      select jsonb_build_object(
        'business_name',b.business_name,
        'gstin',b.gstin,
        'billing_address',b.billing_address,
        'created_at',b.created_at,
        'updated_at',b.updated_at
      ) from public.business_profiles b where b.user_id=p.id limit 1
    ),
    'orders', jsonb_build_object(
      'total',(select count(*) from public.orders o where o.user_id=p.id),
      'paid',(select count(*) from public.orders o where o.user_id=p.id and o.status='paid'),
      'cod_pending',(select count(*) from public.orders o where o.user_id=p.id and o.status='cod_pending'),
      'cancelled',(select count(*) from public.orders o where o.user_id=p.id and (o.status in ('cancelled','cod_cancelled') or o.fulfillment_status='cancelled')),
      'refunded',(select count(*) from public.orders o where o.user_id=p.id and o.status='refunded'),
      'total_spend',coalesce((select sum(o.total_amount) from public.orders o where o.user_id=p.id and o.status in ('paid','cod_pending','cod_collected','refunded','refund_initiated','refund_pending')),0),
      'last_order_at',(select max(o.created_at) from public.orders o where o.user_id=p.id),
      'recent',coalesce((select jsonb_agg(x.obj order by x.created_at desc) from (
        select o.created_at,
          jsonb_build_object(
            'id',o.id,
            'display_order_id',o.display_order_id,
            'total_amount',o.total_amount,
            'currency',o.currency,
            'status',o.status,
            'payment_method',o.payment_method,
            'fulfillment_status',o.fulfillment_status,
            'created_at',o.created_at,
            'items',o.items
          ) as obj
        from public.orders o
        where o.user_id=p.id
        order by o.created_at desc
        limit 20
      ) x),'[]'::jsonb)
    ),
    'returns', jsonb_build_object(
      'total',(select count(*) from public.return_requests r where r.user_id=p.id),
      'open',(select count(*) from public.return_requests r where r.user_id=p.id and r.status not in ('completed','rejected','cancelled')),
      'completed',(select count(*) from public.return_requests r where r.user_id=p.id and r.status='completed'),
      'last_updated_at',(select max(r.updated_at) from public.return_requests r where r.user_id=p.id)
    ),
    'support', jsonb_build_object(
      'total',(select count(*) from public.support_tickets t where t.customer_id=p.id),
      'customer_support',(select count(*) from public.support_tickets t where t.customer_id=p.id and t.channel='customer_support'),
      'seller_support',(select count(*) from public.support_tickets t where t.customer_id=p.id and t.channel='seller_support'),
      'open',(select count(*) from public.support_tickets t where t.customer_id=p.id and t.status not in ('closed','resolved')),
      'closed',(select count(*) from public.support_tickets t where t.customer_id=p.id and t.status in ('closed','resolved')),
      'reopened',coalesce((select sum(t.reopen_count) from public.support_tickets t where t.customer_id=p.id),0),
      'last_updated_at',(select max(t.updated_at) from public.support_tickets t where t.customer_id=p.id)
    ),
    'wishlist', jsonb_build_object(
      'count',(select count(*) from public.customer_wishlist w where w.user_id=p.id)
    )
  ) into v_result
  from public.profiles p
  join auth.users u on u.id=p.id
  where p.id=p_customer_id;

  return v_result;
end;
$$;

revoke all on function public.admin_get_customer_complete_profile(uuid) from public, anon;
grant execute on function public.admin_get_customer_complete_profile(uuid) to authenticated;
-- END RECOVERED 20260920123119

-- BEGIN RECOVERED 20260920123720_add_owner_and_customer_care_access_model
create table if not exists public.staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('customer_care')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_access enable row level security;
revoke all on public.staff_access from anon, authenticated;

create or replace function public.is_owner_user(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_uid is not null and exists(
    select 1 from public.profiles p where p.id=p_uid and p.is_admin=true
  )
$$;

create or replace function public.is_customer_care_user(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_uid is not null and exists(
    select 1 from public.staff_access s
    where s.user_id=p_uid and s.role='customer_care' and s.status='active'
  )
$$;

revoke all on function public.is_owner_user(uuid) from public, anon;
revoke all on function public.is_customer_care_user(uuid) from public, anon;
grant execute on function public.is_owner_user(uuid) to authenticated;
grant execute on function public.is_customer_care_user(uuid) to authenticated;

create or replace function public.owner_set_customer_care_agent(p_user_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid:=auth.uid();
  v_email text;
  v_name text;
begin
  if not public.is_owner_user(v_uid) then raise exception 'Owner access required'; end if;
  if p_user_id is null then raise exception 'User is required'; end if;
  if public.is_owner_user(p_user_id) then raise exception 'Owner accounts already have full access'; end if;
  select u.email::text, p.full_name into v_email,v_name
  from auth.users u left join public.profiles p on p.id=u.id
  where u.id=p_user_id;
  if v_email is null then raise exception 'User not found'; end if;

  insert into public.staff_access(user_id,role,status,created_by,updated_at)
  values(p_user_id,'customer_care',case when p_active then 'active' else 'inactive' end,v_uid,now())
  on conflict(user_id) do update set role='customer_care',status=excluded.status,updated_at=now();

  return jsonb_build_object('user_id',p_user_id,'email',v_email,'full_name',v_name,'role','customer_care','status',case when p_active then 'active' else 'inactive' end);
end;
$$;

revoke all on function public.owner_set_customer_care_agent(uuid,boolean) from public, anon;
grant execute on function public.owner_set_customer_care_agent(uuid,boolean) to authenticated;

create or replace function public.owner_list_staff()
returns table(user_id uuid, full_name text, email text, role text, status text, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_owner_user(auth.uid()) then raise exception 'Owner access required'; end if;
  return query
  select s.user_id,p.full_name,u.email::text,s.role,s.status,s.created_at,s.updated_at
  from public.staff_access s
  join auth.users u on u.id=s.user_id
  left join public.profiles p on p.id=s.user_id
  order by s.created_at desc;
end;
$$;

revoke all on function public.owner_list_staff() from public, anon;
grant execute on function public.owner_list_staff() to authenticated;

alter table public.support_ticket_messages drop constraint if exists support_ticket_messages_sender_role_check;
alter table public.support_ticket_messages add constraint support_ticket_messages_sender_role_check
check (sender_role in ('customer','admin','customer_care','seller','system'));

drop policy if exists support_tickets_select_permitted on public.support_tickets;
create policy support_tickets_select_permitted
on public.support_tickets for select to authenticated
using (
  customer_id=auth.uid()
  or public.is_owner_user(auth.uid())
  or (channel='customer_support' and public.is_customer_care_user(auth.uid()))
  or (channel='seller_support' and seller_id=auth.uid() and exists(select 1 from public.seller_profiles s where s.user_id=auth.uid() and s.status='active'))
);

drop policy if exists support_messages_select_permitted on public.support_ticket_messages;
create policy support_messages_select_permitted
on public.support_ticket_messages for select to authenticated
using (
  exists(
    select 1 from public.support_tickets t
    where t.id=support_ticket_messages.ticket_id
      and (
        t.customer_id=auth.uid()
        or public.is_owner_user(auth.uid())
        or (t.channel='customer_support' and public.is_customer_care_user(auth.uid()))
        or (t.channel='seller_support' and t.seller_id=auth.uid() and exists(select 1 from public.seller_profiles s where s.user_id=auth.uid() and s.status='active'))
      )
  )
);

create or replace function public.send_support_ticket_message(p_ticket_id bigint, p_message text)
returns public.support_ticket_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid:=auth.uid();
  v_ticket public.support_tickets;
  v_role text;
  v_row public.support_ticket_messages;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 5000 then raise exception 'Message is required'; end if;
  if not public.consume_api_rate_limit(v_uid::text,'support_ticket_message',30,60) then raise exception 'Too many support messages. Please wait a moment.'; end if;
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_ticket.status='closed' then raise exception 'This ticket is closed. Reopen it before replying.'; end if;

  if v_ticket.customer_id=v_uid then
    v_role:='customer';
  elsif public.is_owner_user(v_uid) then
    v_role:='admin';
  elsif v_ticket.channel='customer_support' and public.is_customer_care_user(v_uid) then
    v_role:='customer_care';
  elsif v_ticket.channel='seller_support' and v_ticket.seller_id=v_uid and exists(select 1 from public.seller_profiles s where s.user_id=v_uid and s.status='active') then
    v_role:='seller';
  else
    raise exception 'You do not have permission to reply to this ticket';
  end if;

  insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  values(v_ticket.id,v_uid,v_role,btrim(p_message),'web') returning * into v_row;

  update public.support_tickets
  set status=case when v_role='customer' then case when channel='seller_support' then 'waiting_seller' else 'waiting_admin' end else 'waiting_customer' end,
      updated_at=now()
  where id=v_ticket.id;
  return v_row;
end;
$$;

create or replace function public.close_support_ticket(p_ticket_id bigint, p_resolution_summary text)
returns public.support_tickets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid:=auth.uid();
  v_ticket public.support_tickets;
  v_role text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_resolution_summary,''))) not between 3 and 2000 then raise exception 'Resolution summary is required'; end if;
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;

  if public.is_owner_user(v_uid) then
    v_role:='admin';
  elsif v_ticket.channel='customer_support' and public.is_customer_care_user(v_uid) then
    v_role:='customer_care';
  elsif v_ticket.channel='seller_support' and v_ticket.seller_id=v_uid and exists(select 1 from public.seller_profiles s where s.user_id=v_uid and s.status='active') then
    v_role:='seller';
  else
    raise exception 'You do not have permission to close this ticket';
  end if;

  update public.support_tickets
  set status='closed',resolution_summary=btrim(p_resolution_summary),resolved_at=now(),closed_at=now(),updated_at=now()
  where id=v_ticket.id returning * into v_ticket;
  insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source)
  values(v_ticket.id,v_uid,v_role,'Ticket closed: '||btrim(p_resolution_summary),'system');
  return v_ticket;
end;
$$;

create or replace function public.owner_business_overview()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid:=auth.uid();
begin
  if not public.is_owner_user(v_uid) then raise exception 'Owner access required'; end if;
  return jsonb_build_object(
    'customers',jsonb_build_object(
      'total',(select count(*) from public.profiles p where coalesce(p.is_admin,false)=false and not exists(select 1 from public.seller_profiles s where s.user_id=p.id)),
      'business_customers',(select count(*) from public.business_profiles)
    ),
    'sellers',jsonb_build_object(
      'total',(select count(*) from public.seller_profiles),
      'active',(select count(*) from public.seller_profiles where status='active'),
      'pending_products',(select count(*) from public.seller_product_submissions where status='pending'),
      'approved_products',(select count(*) from public.seller_product_submissions where status='approved'),
      'rejected_products',(select count(*) from public.seller_product_submissions where status='rejected')
    ),
    'catalog',jsonb_build_object(
      'products',(select count(*) from public.products),
      'active_products',(select count(*) from public.products where is_active=true),
      'variants',(select count(*) from public.product_variants),
      'active_variants',(select count(*) from public.product_variants where is_active=true)
    ),
    'inventory',jsonb_build_object(
      'on_hand',coalesce((select sum(on_hand) from public.inventory_levels),0),
      'reserved',coalesce((select sum(reserved) from public.inventory_levels),0),
      'available',coalesce((select sum(greatest(on_hand-reserved,0)) from public.inventory_levels),0),
      'low_stock_variants',(select count(*) from public.inventory_levels where greatest(on_hand-reserved,0)<=reorder_level)
    ),
    'orders',jsonb_build_object(
      'total',(select count(*) from public.orders),
      'paid',(select count(*) from public.orders where status='paid'),
      'cod_pending',(select count(*) from public.orders where status='cod_pending'),
      'cancelled',(select count(*) from public.orders where status in ('cancelled','cod_cancelled') or fulfillment_status='cancelled'),
      'open_fulfillment',(select count(*) from public.orders where fulfillment_status not in ('delivered','cancelled')),
      'order_value',coalesce((select sum(total_amount) from public.orders where status not in ('creating','payment_failed','expired','cancelled','cod_cancelled')),0)
    ),
    'payments',jsonb_build_object(
      'open_exceptions',(select count(*) from public.payment_exceptions where status<>'resolved'),
      'total_exceptions',(select count(*) from public.payment_exceptions)
    ),
    'shipping',jsonb_build_object(
      'shipments',(select count(*) from public.order_shipments),
      'with_awb',(select count(*) from public.order_shipments where nullif(awb_code,'') is not null),
      'pickup_requested',(select count(*) from public.order_shipments where pickup_requested_at is not null)
    ),
    'returns',jsonb_build_object(
      'total',(select count(*) from public.return_requests),
      'open',(select count(*) from public.return_requests where status not in ('completed','rejected','cancelled')),
      'refund_value',coalesce((select sum(refund_amount) from public.return_requests where refund_amount is not null),0)
    ),
    'support',jsonb_build_object(
      'customer_total',(select count(*) from public.support_tickets where channel='customer_support'),
      'customer_open',(select count(*) from public.support_tickets where channel='customer_support' and status not in ('closed','resolved')),
      'seller_total',(select count(*) from public.support_tickets where channel='seller_support'),
      'seller_open',(select count(*) from public.support_tickets where channel='seller_support' and status not in ('closed','resolved')),
      'overdue',(select count(*) from public.support_tickets where status not in ('closed','resolved') and sla_due_at<now()),
      'reopened',coalesce((select sum(reopen_count) from public.support_tickets),0)
    ),
    'promotions',jsonb_build_object(
      'active_coupons',(select count(*) from public.coupons where is_active=true and starts_at<=now() and (expires_at is null or expires_at>now())),
      'active_gift_card_products',(select count(*) from public.gift_cards where is_active=true),
      'active_gift_codes',(select count(*) from public.gift_card_codes where is_active=true and balance>0 and (expires_at is null or expires_at>now())),
      'gift_balance_outstanding',coalesce((select sum(balance) from public.gift_card_codes where is_active=true),0)
    ),
    'b2b',jsonb_build_object(
      'quotes',(select count(*) from public.bulk_quotes),
      'open_quotes',(select count(*) from public.bulk_quotes where status not in ('ordered','rejected','expired')),
      'quoted_value',coalesce((select sum(quoted_total) from public.bulk_quotes where quoted_total is not null),0)
    ),
    'generated_at',now()
  );
end;
$$;

revoke all on function public.owner_business_overview() from public, anon;
grant execute on function public.owner_business_overview() to authenticated;

create or replace function public.owner_list_support_tickets(
  p_channel text default null,
  p_status text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  ticket_id bigint,ticket_code text,channel text,status text,priority text,issue_type text,subject text,
  customer_id uuid,customer_name text,customer_email text,customer_phone text,
  order_id bigint,display_order_id text,product_id bigint,seller_id uuid,seller_code text,seller_store text,
  sla_due_at timestamptz,reopen_count integer,created_at timestamptz,updated_at timestamptz,last_message_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_search text:=nullif(trim(coalesce(p_search,'')),'');
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not public.is_owner_user(auth.uid()) then raise exception 'Owner access required'; end if;
  return query
  select t.id,t.ticket_code,t.channel,t.status,t.priority,t.issue_type,t.subject,
         t.customer_id,cp.full_name,cu.email::text,cp.phone,
         t.order_id,o.display_order_id,t.product_id,t.seller_id,sp.seller_code,sp.store_name,
         t.sla_due_at,t.reopen_count,t.created_at,t.updated_at,
         (select max(m.created_at) from public.support_ticket_messages m where m.ticket_id=t.id)
  from public.support_tickets t
  left join public.profiles cp on cp.id=t.customer_id
  left join auth.users cu on cu.id=t.customer_id
  left join public.orders o on o.id=t.order_id
  left join public.seller_profiles sp on sp.user_id=t.seller_id
  where (nullif(trim(coalesce(p_channel,'')),'') is null or t.channel=trim(p_channel))
    and (nullif(trim(coalesce(p_status,'')),'') is null or t.status=trim(p_status))
    and (v_search is null
      or t.ticket_code ilike '%'||v_search||'%'
      or t.subject ilike '%'||v_search||'%'
      or coalesce(cp.full_name,'') ilike '%'||v_search||'%'
      or coalesce(cu.email,'') ilike '%'||v_search||'%'
      or coalesce(cp.phone,'') ilike '%'||v_search||'%'
      or coalesce(o.display_order_id,'') ilike '%'||v_search||'%'
      or coalesce(sp.seller_code,'') ilike '%'||v_search||'%'
      or coalesce(sp.store_name,'') ilike '%'||v_search||'%')
  order by t.updated_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.owner_list_support_tickets(text,text,text,integer,integer) from public, anon;
grant execute on function public.owner_list_support_tickets(text,text,text,integer,integer) to authenticated;

create or replace function public.owner_get_support_ticket_detail(p_ticket_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.support_tickets;
begin
  if not public.is_owner_user(auth.uid()) then raise exception 'Owner access required'; end if;
  select * into v_ticket from public.support_tickets where upper(ticket_code)=upper(trim(p_ticket_code)) limit 1;
  if not found then raise exception 'Ticket not found'; end if;
  return jsonb_build_object(
    'ticket',to_jsonb(v_ticket),
    'customer',(select jsonb_build_object('customer_id',p.id,'full_name',p.full_name,'phone',p.phone,'email',u.email) from public.profiles p join auth.users u on u.id=p.id where p.id=v_ticket.customer_id),
    'seller',(select jsonb_build_object('seller_id',s.user_id,'seller_code',s.seller_code,'store_name',s.store_name,'seller_type',s.seller_type,'phone',s.phone,'status',s.status,'email',u.email) from public.seller_profiles s join auth.users u on u.id=s.user_id where s.user_id=v_ticket.seller_id),
    'order',(select jsonb_build_object('id',o.id,'display_order_id',o.display_order_id,'status',o.status,'payment_method',o.payment_method,'fulfillment_status',o.fulfillment_status,'total_amount',o.total_amount,'currency',o.currency,'items',o.items,'shipping_address',o.shipping_address,'created_at',o.created_at) from public.orders o where o.id=v_ticket.order_id),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'sender_user_id',m.sender_user_id,'sender_role',m.sender_role,'message',m.message,'source',m.source,'created_at',m.created_at) order by m.created_at) from public.support_ticket_messages m where m.ticket_id=v_ticket.id),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.owner_get_support_ticket_detail(text) from public, anon;
grant execute on function public.owner_get_support_ticket_detail(text) to authenticated;

create or replace function public.support_staff_list_customer_tickets(
  p_status text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  ticket_id bigint,ticket_code text,status text,priority text,issue_type text,subject text,
  customer_id uuid,customer_name text,customer_email text,customer_phone text,
  order_id bigint,display_order_id text,sla_due_at timestamptz,reopen_count integer,created_at timestamptz,updated_at timestamptz,last_message_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid:=auth.uid();
  v_search text:=nullif(trim(coalesce(p_search,'')),'');
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),200);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not (public.is_owner_user(v_uid) or public.is_customer_care_user(v_uid)) then raise exception 'Customer Care access required'; end if;
  return query
  select t.id,t.ticket_code,t.status,t.priority,t.issue_type,t.subject,
         t.customer_id,p.full_name,u.email::text,p.phone,t.order_id,o.display_order_id,
         t.sla_due_at,t.reopen_count,t.created_at,t.updated_at,
         (select max(m.created_at) from public.support_ticket_messages m where m.ticket_id=t.id)
  from public.support_tickets t
  left join public.profiles p on p.id=t.customer_id
  left join auth.users u on u.id=t.customer_id
  left join public.orders o on o.id=t.order_id
  where t.channel='customer_support'
    and (nullif(trim(coalesce(p_status,'')),'') is null or t.status=trim(p_status))
    and (v_search is null
      or t.ticket_code ilike '%'||v_search||'%'
      or t.subject ilike '%'||v_search||'%'
      or coalesce(p.full_name,'') ilike '%'||v_search||'%'
      or coalesce(u.email,'') ilike '%'||v_search||'%'
      or coalesce(p.phone,'') ilike '%'||v_search||'%'
      or coalesce(o.display_order_id,'') ilike '%'||v_search||'%')
  order by t.updated_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.support_staff_list_customer_tickets(text,text,integer,integer) from public, anon;
grant execute on function public.support_staff_list_customer_tickets(text,text,integer,integer) to authenticated;

create or replace function public.support_staff_get_customer_ticket_detail(p_ticket_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid:=auth.uid();
  v_ticket public.support_tickets;
begin
  if not (public.is_owner_user(v_uid) or public.is_customer_care_user(v_uid)) then raise exception 'Customer Care access required'; end if;
  select * into v_ticket from public.support_tickets where upper(ticket_code)=upper(trim(p_ticket_code)) and channel='customer_support' limit 1;
  if not found then raise exception 'Customer Support ticket not found'; end if;
  return jsonb_build_object(
    'ticket',to_jsonb(v_ticket),
    'customer',(select jsonb_build_object('customer_id',p.id,'full_name',p.full_name,'phone',p.phone,'email',u.email) from public.profiles p join auth.users u on u.id=p.id where p.id=v_ticket.customer_id),
    'order',(select jsonb_build_object('id',o.id,'display_order_id',o.display_order_id,'status',o.status,'payment_method',o.payment_method,'fulfillment_status',o.fulfillment_status,'total_amount',o.total_amount,'currency',o.currency,'items',o.items,'shipping_address',o.shipping_address,'created_at',o.created_at) from public.orders o where o.id=v_ticket.order_id),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'sender_user_id',m.sender_user_id,'sender_role',m.sender_role,'message',m.message,'source',m.source,'created_at',m.created_at) order by m.created_at) from public.support_ticket_messages m where m.ticket_id=v_ticket.id),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.support_staff_get_customer_ticket_detail(text) from public, anon;
grant execute on function public.support_staff_get_customer_ticket_detail(text) to authenticated;
-- END RECOVERED 20260920123720

-- BEGIN RECOVERED 20260920125604_harden_support_trigger_and_staff_access
revoke execute on function public.support_set_ticket_defaults() from public, anon, authenticated;

drop policy if exists staff_access_owner_select on public.staff_access;
create policy staff_access_owner_select
on public.staff_access
for select to authenticated
using (public.is_owner_user(auth.uid()));

drop policy if exists staff_access_owner_insert on public.staff_access;
create policy staff_access_owner_insert
on public.staff_access
for insert to authenticated
with check (public.is_owner_user(auth.uid()));

drop policy if exists staff_access_owner_update on public.staff_access;
create policy staff_access_owner_update
on public.staff_access
for update to authenticated
using (public.is_owner_user(auth.uid()))
with check (public.is_owner_user(auth.uid()));

drop policy if exists staff_access_owner_delete on public.staff_access;
create policy staff_access_owner_delete
on public.staff_access
for delete to authenticated
using (public.is_owner_user(auth.uid()));
-- END RECOVERED 20260920125604

-- BEGIN RECOVERED 20260920125652_optimize_support_owner_rls_and_indexes
create index if not exists staff_access_created_by_idx on public.staff_access(created_by);
create index if not exists support_contact_config_updated_by_idx on public.support_contact_config(updated_by);
create index if not exists support_ticket_messages_sender_user_id_idx on public.support_ticket_messages(sender_user_id);
create index if not exists support_tickets_product_id_idx on public.support_tickets(product_id);

drop policy if exists support_contact_config_select on public.support_contact_config;
create policy support_contact_config_select
on public.support_contact_config
for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)
  or exists (select 1 from public.seller_profiles s where s.user_id = (select auth.uid()) and s.status = 'active')
);

drop policy if exists support_contact_config_admin_update on public.support_contact_config;
create policy support_contact_config_admin_update
on public.support_contact_config
for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));

drop policy if exists staff_access_owner_select on public.staff_access;
create policy staff_access_owner_select on public.staff_access for select to authenticated
using (public.is_owner_user((select auth.uid())));

drop policy if exists staff_access_owner_insert on public.staff_access;
create policy staff_access_owner_insert on public.staff_access for insert to authenticated
with check (public.is_owner_user((select auth.uid())));

drop policy if exists staff_access_owner_update on public.staff_access;
create policy staff_access_owner_update on public.staff_access for update to authenticated
using (public.is_owner_user((select auth.uid())))
with check (public.is_owner_user((select auth.uid())));

drop policy if exists staff_access_owner_delete on public.staff_access;
create policy staff_access_owner_delete on public.staff_access for delete to authenticated
using (public.is_owner_user((select auth.uid())));

drop policy if exists support_tickets_select_permitted on public.support_tickets;
create policy support_tickets_select_permitted
on public.support_tickets for select to authenticated
using (
  customer_id=(select auth.uid())
  or public.is_owner_user((select auth.uid()))
  or (channel='customer_support' and public.is_customer_care_user((select auth.uid())))
  or (channel='seller_support' and seller_id=(select auth.uid()) and exists(select 1 from public.seller_profiles s where s.user_id=(select auth.uid()) and s.status='active'))
);

drop policy if exists support_messages_select_permitted on public.support_ticket_messages;
create policy support_messages_select_permitted
on public.support_ticket_messages for select to authenticated
using (
  exists(
    select 1 from public.support_tickets t
    where t.id=support_ticket_messages.ticket_id
      and (
        t.customer_id=(select auth.uid())
        or public.is_owner_user((select auth.uid()))
        or (t.channel='customer_support' and public.is_customer_care_user((select auth.uid())))
        or (t.channel='seller_support' and t.seller_id=(select auth.uid()) and exists(select 1 from public.seller_profiles s where s.user_id=(select auth.uid()) and s.status='active'))
      )
  )
);
-- END RECOVERED 20260920125652

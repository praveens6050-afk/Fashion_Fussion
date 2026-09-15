create or replace function public.create_bulk_quote_request(
  p_product_id bigint,
  p_quantity integer,
  p_customer_note text default null
)
returns table(quote_id bigint, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.business_profiles%rowtype;
  v_product public.products%rowtype;
  v_quote_id bigint;
  v_unit_price numeric;
  v_note text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_quantity is null or p_quantity < 2 or p_quantity > 500 then
    raise exception 'Quantity must be between 2 and 500';
  end if;

  select * into v_profile
  from public.business_profiles
  where user_id = v_user_id;

  if not found or nullif(trim(v_profile.business_name), '') is null then
    raise exception 'Save your business details before requesting a quote';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and is_active = true;

  if not found then
    raise exception 'Product is unavailable';
  end if;

  if coalesce(v_product.bulk_enabled, false) is not true then
    raise exception 'This product is not enabled for bulk quotes';
  end if;

  if v_product.bulk_min_qty is null or v_product.bulk_min_qty < 2 then
    raise exception 'Bulk minimum quantity is not configured';
  end if;

  if p_quantity < v_product.bulk_min_qty then
    raise exception 'Quantity is below the minimum bulk quantity';
  end if;

  select t.unit_price into v_unit_price
  from public.product_bulk_tiers t
  where t.product_id = p_product_id
    and t.min_qty <= p_quantity
    and t.unit_price > 0
    and t.unit_price <= v_product.price
  order by t.min_qty desc
  limit 1;

  if v_unit_price is null then
    v_unit_price := v_product.price;
  end if;

  if v_unit_price is null or v_unit_price <= 0 then
    raise exception 'Product pricing is invalid';
  end if;

  v_note := nullif(trim(coalesce(p_customer_note, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Quote note is too long';
  end if;

  insert into public.bulk_quotes(
    user_id,
    business_name,
    gstin,
    status,
    customer_note
  ) values (
    v_user_id,
    trim(v_profile.business_name),
    nullif(trim(coalesce(v_profile.gstin, '')), ''),
    'requested',
    v_note
  )
  returning id into v_quote_id;

  insert into public.bulk_quote_items(
    quote_id,
    product_id,
    quantity,
    requested_unit_price
  ) values (
    v_quote_id,
    p_product_id,
    p_quantity,
    v_unit_price
  );

  return query select v_quote_id, 'requested'::text;
end;
$$;

revoke all on function public.create_bulk_quote_request(bigint, integer, text) from public;
grant execute on function public.create_bulk_quote_request(bigint, integer, text) to authenticated;
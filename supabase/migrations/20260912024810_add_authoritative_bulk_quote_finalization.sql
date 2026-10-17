alter table public.bulk_quotes
  add column if not exists quoted_subtotal numeric,
  add column if not exists quoted_gst numeric,
  add column if not exists quoted_delivery numeric,
  add column if not exists quoted_at timestamptz;

alter table public.bulk_quotes
  drop constraint if exists bulk_quotes_quoted_subtotal_check,
  add constraint bulk_quotes_quoted_subtotal_check check (quoted_subtotal is null or quoted_subtotal >= 0),
  drop constraint if exists bulk_quotes_quoted_gst_check,
  add constraint bulk_quotes_quoted_gst_check check (quoted_gst is null or quoted_gst >= 0),
  drop constraint if exists bulk_quotes_quoted_delivery_check,
  add constraint bulk_quotes_quoted_delivery_check check (quoted_delivery is null or quoted_delivery >= 0);

create or replace function public.finalize_bulk_quote(
  p_quote_id bigint,
  p_item_prices jsonb,
  p_valid_until timestamptz default null,
  p_admin_note text default null
)
returns table(
  quote_id bigint,
  status text,
  quoted_subtotal numeric,
  quoted_gst numeric,
  quoted_delivery numeric,
  quoted_total numeric,
  valid_until timestamptz,
  quoted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin boolean := false;
  v_quote public.bulk_quotes%rowtype;
  v_item record;
  v_price numeric;
  v_subtotal numeric := 0;
  v_gst numeric := 0;
  v_delivery numeric := 0;
  v_count integer := 0;
  v_expected integer := 0;
  v_note text;
begin
  select coalesce(p.is_admin,false) into v_admin
  from public.profiles p
  where p.id = auth.uid();

  if not coalesce(v_admin,false) then
    raise exception 'Administrator access required';
  end if;

  select * into v_quote
  from public.bulk_quotes
  where id = p_quote_id
  for update;

  if not found then raise exception 'Quote not found'; end if;
  if v_quote.status in ('accepted','cancelled','expired') then
    raise exception 'This quote can no longer be finalized';
  end if;
  if p_valid_until is not null and p_valid_until <= now() then
    raise exception 'Quote validity must be in the future';
  end if;
  if jsonb_typeof(p_item_prices) <> 'array' then
    raise exception 'Item prices are required';
  end if;

  select count(*) into v_expected from public.bulk_quote_items where quote_id = p_quote_id;
  if v_expected < 1 then raise exception 'Quote has no items'; end if;

  for v_item in
    select qi.id, qi.quantity, qi.requested_unit_price, p.price as retail_price, p.gst_rate
    from public.bulk_quote_items qi
    join public.products p on p.id = qi.product_id
    where qi.quote_id = p_quote_id
    order by qi.id
  loop
    select nullif(x->>'quoted_unit_price','')::numeric into v_price
    from jsonb_array_elements(p_item_prices) x
    where (x->>'item_id')::bigint = v_item.id
    limit 1;

    if v_price is null or v_price <= 0 then
      raise exception 'Every quote item needs a positive unit price';
    end if;
    if v_item.retail_price is null or v_item.retail_price <= 0 then
      raise exception 'Product retail price is invalid';
    end if;
    if v_price > v_item.retail_price then
      raise exception 'Quoted unit price cannot exceed current retail price';
    end if;
    if v_item.gst_rate is null or v_item.gst_rate < 0 or v_item.gst_rate > 100 then
      raise exception 'Product GST rate is invalid';
    end if;

    update public.bulk_quote_items
      set quoted_unit_price = round(v_price,2)
      where id = v_item.id and quote_id = p_quote_id;

    v_subtotal := v_subtotal + round(v_price * v_item.quantity,2);
    v_gst := v_gst + round((v_price * v_item.quantity) * (v_item.gst_rate / 100.0),2);
    v_count := v_count + 1;
  end loop;

  if v_count <> v_expected then raise exception 'Quote item pricing is incomplete'; end if;

  v_delivery := case when v_subtotal < 299 then 49 else 0 end;
  v_note := nullif(trim(coalesce(p_admin_note,'')), '');
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'Admin note is too long'; end if;

  update public.bulk_quotes
  set status='quoted',
      quoted_subtotal=round(v_subtotal,2),
      quoted_gst=round(v_gst,2),
      quoted_delivery=round(v_delivery,2),
      quoted_total=round(v_subtotal+v_gst+v_delivery,2),
      valid_until=p_valid_until,
      admin_note=v_note,
      quoted_at=now(),
      accepted_at=null,
      updated_at=now()
  where id=p_quote_id
  returning * into v_quote;

  return query select v_quote.id,v_quote.status,v_quote.quoted_subtotal,v_quote.quoted_gst,v_quote.quoted_delivery,v_quote.quoted_total,v_quote.valid_until,v_quote.quoted_at;
end;
$$;

revoke all on function public.finalize_bulk_quote(bigint,jsonb,timestamptz,text) from public;
grant execute on function public.finalize_bulk_quote(bigint,jsonb,timestamptz,text) to authenticated;
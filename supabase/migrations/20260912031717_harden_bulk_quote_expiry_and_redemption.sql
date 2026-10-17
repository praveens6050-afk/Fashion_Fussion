alter table public.bulk_quotes
  add column if not exists ordered_at timestamptz;

alter table public.bulk_quotes
  drop constraint if exists bulk_quotes_status_check,
  add constraint bulk_quotes_status_check check (status in ('requested','under_review','quoted','accepted','ordered','rejected','expired','cancelled'));

create or replace function public.accept_bulk_quote(p_quote_id bigint)
returns table(quote_id bigint, status text, quoted_total numeric, valid_until timestamptz, accepted_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_quote public.bulk_quotes%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_quote
  from public.bulk_quotes
  where id = p_quote_id and user_id = v_user_id
  for update;

  if not found then raise exception 'Quote not found'; end if;

  if v_quote.status in ('accepted','ordered') then
    return query select v_quote.id,v_quote.status,v_quote.quoted_total,v_quote.valid_until,v_quote.accepted_at;
    return;
  end if;

  if v_quote.status <> 'quoted' then raise exception 'Only a quoted business quote can be accepted'; end if;
  if v_quote.quoted_total is null or v_quote.quoted_total <= 0 then raise exception 'Quote total is invalid'; end if;

  if v_quote.valid_until is not null and v_quote.valid_until < now() then
    update public.bulk_quotes set status='expired', updated_at=now() where id=v_quote.id returning * into v_quote;
    return query select v_quote.id,v_quote.status,v_quote.quoted_total,v_quote.valid_until,v_quote.accepted_at;
    return;
  end if;

  update public.bulk_quotes
    set status='accepted',accepted_at=now(),updated_at=now()
    where id=v_quote.id
    returning * into v_quote;

  return query select v_quote.id,v_quote.status,v_quote.quoted_total,v_quote.valid_until,v_quote.accepted_at;
end;
$$;

revoke all on function public.accept_bulk_quote(bigint) from public;
grant execute on function public.accept_bulk_quote(bigint) to authenticated;

create or replace function public.finalize_checkout_order(p_order_id bigint, p_user_id uuid, p_payment_id text, p_payment_signature text, p_target_status text, p_source text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  o public.orders%rowtype;
  q public.bulk_quotes%rowtype;
begin
  select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_target_status not in ('paid','cod_pending') then raise exception 'Invalid target status'; end if;
  if p_target_status='paid' and o.payment_method<>'prepaid' then raise exception 'Order is not prepaid'; end if;
  if p_target_status='cod_pending' and o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if p_target_status='paid' and o.total_amount>0 and nullif(trim(coalesce(p_payment_id,'')),'') is null then raise exception 'Payment ID is required'; end if;

  if o.status=p_target_status then
    if p_target_status='paid' and p_payment_id is not null and o.razorpay_payment_id is not null and o.razorpay_payment_id<>p_payment_id then raise exception 'Order is linked to a different payment'; end if;
    if o.bulk_quote_id is not null then
      update public.bulk_quotes set status='ordered',ordered_at=coalesce(ordered_at,now()),updated_at=now()
      where id=o.bulk_quote_id and user_id=p_user_id and status in ('accepted','ordered');
    end if;
    return;
  end if;

  if o.status in ('paid','cod_pending','cod_collected','refunded') then raise exception 'Order is already finalized'; end if;

  if o.bulk_quote_id is not null then
    select * into q from public.bulk_quotes where id=o.bulk_quote_id and user_id=p_user_id for update;
    if not found then raise exception 'Linked business quote was not found'; end if;
    if q.status not in ('accepted','ordered') then raise exception 'Linked business quote is not accepted'; end if;
    if q.valid_until is not null and q.valid_until < now() then raise exception 'Linked business quote has expired'; end if;
    if q.quoted_total is null or abs(q.quoted_total-o.total_amount) > 0.01 then raise exception 'Order total does not match accepted quote'; end if;
  end if;

  if p_target_status='paid' then perform public.finalize_order_promotions(o.id,p_user_id); end if;

  update public.orders
  set razorpay_payment_id=case when p_payment_id is not null then p_payment_id else razorpay_payment_id end,
      razorpay_signature=case when p_payment_signature is not null then p_payment_signature else razorpay_signature end,
      status=p_target_status,
      payment_verified_at=case when p_target_status='paid' then now() else payment_verified_at end,
      payment_source=nullif(trim(coalesce(p_source,'')),'')
  where id=o.id;

  if o.bulk_quote_id is not null then
    update public.bulk_quotes
    set status='ordered',ordered_at=coalesce(ordered_at,now()),updated_at=now()
    where id=o.bulk_quote_id and user_id=p_user_id and status in ('accepted','ordered');
  end if;
end;
$$;

revoke all on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) from public;
grant execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) to service_role;
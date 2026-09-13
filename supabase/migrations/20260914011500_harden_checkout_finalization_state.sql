create or replace function public.finalize_checkout_order(
  p_order_id bigint,
  p_user_id uuid,
  p_payment_id text,
  p_payment_signature text,
  p_target_status text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  o public.orders%rowtype;
  q public.bulk_quotes%rowtype;
begin
  select * into o
  from public.orders
  where id=p_order_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if p_target_status not in ('paid','cod_pending') then raise exception 'Invalid target status'; end if;
  if p_target_status='paid' and o.payment_method<>'prepaid' then raise exception 'Order is not prepaid'; end if;
  if p_target_status='cod_pending' and o.payment_method<>'cod' then raise exception 'Order is not COD'; end if;
  if p_target_status='paid' and o.total_amount>0 and nullif(trim(coalesce(p_payment_id,'')),'') is null then
    raise exception 'Payment ID is required';
  end if;

  if o.status=p_target_status then
    if p_target_status='paid'
      and p_payment_id is not null
      and o.razorpay_payment_id is not null
      and o.razorpay_payment_id<>p_payment_id then
      raise exception 'Order is linked to a different payment';
    end if;
    if o.bulk_quote_id is not null then
      update public.bulk_quotes
      set status='ordered',ordered_at=coalesce(ordered_at,now()),updated_at=now()
      where id=o.bulk_quote_id and user_id=p_user_id and status in ('accepted','ordered');
    end if;
    return;
  end if;

  if o.status not in ('creating','created') then
    raise exception 'Order is not in an active checkout state';
  end if;

  if o.bulk_quote_id is not null then
    select * into q
    from public.bulk_quotes
    where id=o.bulk_quote_id and user_id=p_user_id
    for update;
    if not found then raise exception 'Linked business quote was not found'; end if;
    if q.status not in ('accepted','ordered') then raise exception 'Linked business quote is not accepted'; end if;
    if q.valid_until is not null and q.valid_until < now() then raise exception 'Linked business quote has expired'; end if;
    if q.quoted_total is null or abs(q.quoted_total-o.total_amount) > 0.01 then
      raise exception 'Order total does not match accepted quote';
    end if;
  end if;

  if p_target_status='paid' then
    perform public.finalize_order_promotions(o.id,p_user_id);
  end if;

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
$function$;

revoke all on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_checkout_order(bigint,uuid,text,text,text,text) to service_role;

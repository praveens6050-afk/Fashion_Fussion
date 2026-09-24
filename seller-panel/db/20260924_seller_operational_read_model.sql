-- Seller-scoped operational read model for Orders / Returns / sales collection.
-- Applied to Supabase project gmdevprqtvoshbbytsxf on 2026-09-24.

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

-- Performance-derived Fast Dispatch signal.
-- Seller cannot self-assign this badge. It is derived from persisted order fulfillment timestamps.
--
-- Schema note: public.orders has no seller_id. Seller ownership is represented by
-- approved seller_product_submissions rows (approved_product_id -> products.id).
-- An order qualifies for a seller when its persisted items JSON contains one of
-- that seller's approved product IDs. EXISTS prevents duplicate submissions from
-- multiplying an order in the performance sample.

create or replace function public.get_seller_fast_dispatch_signal(p_seller_id uuid)
returns table(
  seller_id uuid,
  sample_orders bigint,
  fast_dispatch_orders bigint,
  fast_dispatch_rate numeric,
  avg_dispatch_hours numeric,
  fast_dispatch boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with shipped as (
    select
      o.id,
      o.created_at,
      o.fulfillment_updated_at,
      extract(epoch from (o.fulfillment_updated_at - o.created_at)) / 3600.0 as dispatch_hours
    from public.orders o
    where o.fulfillment_status in ('shipped', 'delivered')
      and o.fulfillment_updated_at is not null
      and o.created_at is not null
      and o.fulfillment_updated_at >= o.created_at
      and exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
        ) as item(value)
        join public.seller_product_submissions sps
          on sps.approved_product_id = case
            when coalesce(item.value ->> 'id', '') ~ '^[0-9]+$'
              then (item.value ->> 'id')::bigint
            else null
          end
        where sps.seller_id = p_seller_id
          and sps.status = 'approved'
          and sps.approved_product_id is not null
      )
  ), agg as (
    select
      count(*)::bigint as sample_orders,
      count(*) filter (where dispatch_hours <= 24)::bigint as fast_dispatch_orders,
      coalesce(avg(dispatch_hours), 0)::numeric as avg_dispatch_hours
    from shipped
  )
  select
    p_seller_id,
    a.sample_orders,
    a.fast_dispatch_orders,
    case when a.sample_orders = 0 then 0::numeric
         else round((a.fast_dispatch_orders::numeric / a.sample_orders::numeric) * 100, 2) end,
    round(a.avg_dispatch_hours, 2),
    (a.sample_orders >= 10
      and (a.fast_dispatch_orders::numeric / nullif(a.sample_orders, 0)::numeric) >= 0.90
      and a.avg_dispatch_hours <= 24)
  from agg a;
$$;

revoke all on function public.get_seller_fast_dispatch_signal(uuid) from public, anon, authenticated;
grant execute on function public.get_seller_fast_dispatch_signal(uuid) to service_role;

comment on function public.get_seller_fast_dispatch_signal(uuid) is
'Backend-only seller dispatch-performance signal. Seller attribution uses approved seller_product_submissions mapped to numeric persisted order item product IDs. Requires >=10 shipped/delivered orders, >=90% dispatched within 24h, and <=24h average dispatch time.';

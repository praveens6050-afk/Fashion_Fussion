-- Replace the invalid orders.seller_id dependency with immutable seller attribution
-- snapshotted inside orders.items. Historical unattributed orders are excluded.

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
security invoker
set search_path = public, pg_temp
as $$
  with attributed as (
    select
      o.id,
      o.created_at,
      o.fulfillment_updated_at,
      extract(epoch from (o.fulfillment_updated_at - o.created_at)) / 3600.0 as dispatch_hours
    from public.orders o
    where p_seller_id = any(public.order_item_seller_ids(o.items))
      and o.fulfillment_status in ('shipped','delivered')
      and o.fulfillment_updated_at is not null
      and o.created_at is not null
      and o.fulfillment_updated_at >= o.created_at
  ), agg as (
    select
      count(*)::bigint as sample_orders,
      count(*) filter (where dispatch_hours <= 24)::bigint as fast_dispatch_orders,
      coalesce(avg(dispatch_hours),0)::numeric as avg_dispatch_hours
    from attributed
  )
  select
    p_seller_id,
    a.sample_orders,
    a.fast_dispatch_orders,
    case when a.sample_orders = 0 then 0::numeric
         else round((a.fast_dispatch_orders::numeric / a.sample_orders::numeric) * 100, 2) end,
    round(a.avg_dispatch_hours, 2),
    (a.sample_orders >= 10
      and (a.fast_dispatch_orders::numeric / nullif(a.sample_orders,0)::numeric) >= 0.90
      and a.avg_dispatch_hours <= 24)
  from agg a;
$$;

revoke all on function public.get_seller_fast_dispatch_signal(uuid) from public, anon, authenticated;
grant execute on function public.get_seller_fast_dispatch_signal(uuid) to service_role;

comment on function public.get_seller_fast_dispatch_signal(uuid) is
'Backend seller dispatch signal using immutable seller_id snapshots in order items. Historical orders without trusted seller attribution are excluded.';

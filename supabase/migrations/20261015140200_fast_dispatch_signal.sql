-- Performance-derived Fast Dispatch signal.
-- Fail closed until seller-level order attribution and a verified dispatch-handoff
-- timestamp exist. orders.seller_id is not part of the current schema, and the
-- order-level fulfillment_updated_at cannot prove a particular seller's handoff.
-- Do not infer seller performance from order-level status or product ownership.

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
set search_path = pg_catalog
as $$
  select
    p_seller_id,
    0::bigint,
    0::bigint,
    null::numeric,
    null::numeric,
    false;
$$;

revoke all on function public.get_seller_fast_dispatch_signal(uuid) from public, anon, authenticated;
grant execute on function public.get_seller_fast_dispatch_signal(uuid) to service_role;

comment on function public.get_seller_fast_dispatch_signal(uuid) is
'Backend-only fail-closed Fast Dispatch signal. Returns no eligible samples until trustworthy seller-attributed dispatch-handoff data is implemented and verified; do not expose a badge from order-level timestamps.';

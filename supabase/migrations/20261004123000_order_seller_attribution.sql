-- Immutable seller attribution foundation for seller-level fulfillment metrics.
-- New orders should snapshot seller_id into each orders.items JSON object at checkout.
-- Historical rows without trusted attribution remain unattributed; do not guess ownership.

create or replace function public.order_item_seller_ids(p_items jsonb)
returns uuid[]
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct (item->>'seller_id')::uuid), array[]::uuid[])
  from jsonb_array_elements(p_items) item
  where nullif(item->>'seller_id','') is not null
    and (item->>'seller_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

revoke all on function public.order_item_seller_ids(jsonb) from public, anon, authenticated;
grant execute on function public.order_item_seller_ids(jsonb) to service_role;

comment on function public.order_item_seller_ids(jsonb) is
'Backend helper returning seller IDs explicitly snapshotted into order item JSON. Never infers historical seller ownership.';

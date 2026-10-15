-- Private, immutable seller attribution snapshots for order lines.
-- These rows are separate from orders.items so customer order reads do not expose seller UUIDs.
-- No dispatch signal should be enabled from these snapshots alone; verified seller-level
-- dispatch-handoff events and a per-seller shipment model are still required.

begin;

create table if not exists public.order_item_seller_snapshots (
  order_id bigint not null references public.orders(id) on delete cascade,
  line_index integer not null check (line_index >= 0),
  product_id bigint not null check (product_id > 0),
  variant_id bigint null check (variant_id is null or variant_id > 0),
  seller_id uuid null,
  attribution_status text not null check (attribution_status in ('seller_attributed', 'unmapped', 'ambiguous')),
  created_at timestamptz not null default now(),
  primary key (order_id, line_index),
  check (
    (attribution_status = 'seller_attributed' and seller_id is not null)
    or
    (attribution_status in ('unmapped', 'ambiguous') and seller_id is null)
  )
);

create index if not exists order_item_seller_snapshots_seller_order_idx
  on public.order_item_seller_snapshots (seller_id, order_id)
  where seller_id is not null;

alter table public.order_item_seller_snapshots enable row level security;

revoke all on table public.order_item_seller_snapshots from public, anon, authenticated, service_role;
grant select, insert on table public.order_item_seller_snapshots to service_role;

drop policy if exists order_item_seller_snapshots_service_role_only
  on public.order_item_seller_snapshots;
create policy order_item_seller_snapshots_service_role_only
  on public.order_item_seller_snapshots
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.order_item_seller_snapshots is
'Backend-only immutable-attribution snapshot for each order line. Seller IDs are intentionally stored outside customer-visible orders.items.';

commit;

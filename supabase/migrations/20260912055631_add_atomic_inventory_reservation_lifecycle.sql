create table if not exists public.order_inventory_reservations (
  order_id bigint not null references public.orders(id) on delete cascade,
  variant_id bigint not null references public.product_variants(id) on delete restrict,
  quantity integer not null,
  status text not null default 'reserved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  primary key(order_id, variant_id),
  constraint order_inventory_reservations_quantity_positive check(quantity > 0),
  constraint order_inventory_reservations_status_check check(status in ('reserved','committed','released'))
);
create index if not exists order_inventory_reservations_variant_status_idx on public.order_inventory_reservations(variant_id,status);
alter table public.order_inventory_reservations enable row level security;
create policy order_inventory_reservations_admin_select on public.order_inventory_reservations for select to authenticated using (exists(select 1 from public.profiles pr where pr.id=auth.uid() and pr.is_admin=true));

create or replace function public.reserve_order_inventory(p_order_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; v_available integer;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service role required'; end if;
  for r in
    select (x->>'variant_id')::bigint variant_id, sum((x->>'qty')::integer)::integer quantity
    from public.orders o cross join lateral jsonb_array_elements(o.items::jsonb) x
    where o.id=p_order_id and x ? 'variant_id' and nullif(x->>'variant_id','') is not null
    group by (x->>'variant_id')::bigint
  loop
    if exists(select 1 from public.order_inventory_reservations where order_id=p_order_id and variant_id=r.variant_id) then continue; end if;
    select on_hand-reserved into v_available from public.inventory_levels where variant_id=r.variant_id for update;
    if v_available is null or v_available < r.quantity then raise exception 'Insufficient inventory for variant %',r.variant_id; end if;
    update public.inventory_levels set reserved=reserved+r.quantity,updated_at=now() where variant_id=r.variant_id;
    insert into public.order_inventory_reservations(order_id,variant_id,quantity) values(p_order_id,r.variant_id,r.quantity);
    insert into public.inventory_movements(variant_id,movement_type,quantity_delta,reference_type,reference_id,note) values(r.variant_id,'reserve',r.quantity,'order',p_order_id::text,'Checkout inventory reservation');
  end loop;
end $$;

create or replace function public.commit_order_inventory(p_order_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service role required'; end if;
  for r in select * from public.order_inventory_reservations where order_id=p_order_id and status='reserved' for update loop
    update public.inventory_levels set on_hand=on_hand-r.quantity,reserved=reserved-r.quantity,updated_at=now() where variant_id=r.variant_id and reserved>=r.quantity and on_hand>=r.quantity;
    if not found then raise exception 'Inventory commit mismatch for variant %',r.variant_id; end if;
    update public.order_inventory_reservations set status='committed',committed_at=now(),updated_at=now() where order_id=p_order_id and variant_id=r.variant_id;
    insert into public.inventory_movements(variant_id,movement_type,quantity_delta,reference_type,reference_id,note) values(r.variant_id,'order_commit',-r.quantity,'order',p_order_id::text,'Order inventory committed');
  end loop;
end $$;

create or replace function public.release_order_inventory(p_order_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service role required'; end if;
  for r in select * from public.order_inventory_reservations where order_id=p_order_id and status='reserved' for update loop
    update public.inventory_levels set reserved=reserved-r.quantity,updated_at=now() where variant_id=r.variant_id and reserved>=r.quantity;
    if not found then raise exception 'Inventory release mismatch for variant %',r.variant_id; end if;
    update public.order_inventory_reservations set status='released',released_at=now(),updated_at=now() where order_id=p_order_id and variant_id=r.variant_id;
    insert into public.inventory_movements(variant_id,movement_type,quantity_delta,reference_type,reference_id,note) values(r.variant_id,'release',-r.quantity,'order',p_order_id::text,'Order inventory reservation released');
  end loop;
end $$;
revoke all on function public.reserve_order_inventory(bigint) from public;
revoke all on function public.commit_order_inventory(bigint) from public;
revoke all on function public.release_order_inventory(bigint) from public;
grant execute on function public.reserve_order_inventory(bigint) to service_role;
grant execute on function public.commit_order_inventory(bigint) to service_role;
grant execute on function public.release_order_inventory(bigint) to service_role;
-- Acceptance checks for private order-line seller attribution snapshots.
begin;

do $$
begin
  if to_regclass('public.order_item_seller_snapshots') is null then
    raise exception 'order_item_seller_snapshots table is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.order_item_seller_snapshots'::regclass) then
    raise exception 'order_item_seller_snapshots must have row-level security enabled';
  end if;

  if has_table_privilege('anon', 'public.order_item_seller_snapshots', 'SELECT')
     or has_table_privilege('authenticated', 'public.order_item_seller_snapshots', 'SELECT') then
    raise exception 'Browser roles must not read seller attribution snapshots';
  end if;

  if not has_table_privilege('service_role', 'public.order_item_seller_snapshots', 'SELECT')
     or not has_table_privilege('service_role', 'public.order_item_seller_snapshots', 'INSERT') then
    raise exception 'service_role must read and insert seller attribution snapshots';
  end if;

  if has_table_privilege('service_role', 'public.order_item_seller_snapshots', 'UPDATE')
     or has_table_privilege('service_role', 'public.order_item_seller_snapshots', 'DELETE') then
    raise exception 'Seller attribution snapshots must not be mutable through the service REST role';
  end if;
end
$$;

rollback;

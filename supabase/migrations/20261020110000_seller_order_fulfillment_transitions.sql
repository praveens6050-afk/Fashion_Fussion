-- Seller-owned, guarded fulfilment transitions for the production order ledger.
-- This migration does not alter existing order rows; it expands the allowed status set.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status = ANY (ARRAY['ordered'::text, 'processing'::text, 'packed'::text, 'shipped'::text, 'out_for_delivery'::text, 'delivered'::text, 'cancelled'::text]));

create or replace function public.seller_update_order_fulfillment(
  p_order_id bigint,
  p_new_fulfillment_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_current_status text;
  v_owns_order boolean;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_order_id is null or p_new_fulfillment_status not in ('processing','packed','shipped') then
    raise exception using errcode = '22023', message = 'Unsupported order fulfilment transition';
  end if;

  if not exists (
    select 1 from public.seller_profiles sp
    where sp.user_id = v_uid and sp.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active seller profile required';
  end if;

  -- Lock the order first so its item ownership and status cannot change
  -- between authorization and transition validation.
  select o.fulfillment_status
    into v_current_status
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order not found';
  end if;

  select exists (
    select 1
    from public.orders o
    cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as line(item)
    join public.seller_product_submissions s
      on s.seller_id = v_uid
     and s.approved_product_id is not null
     and coalesce(line.item->>'id','') ~ '^[0-9]+
  if not (
    (v_current_status = 'ordered' and p_new_fulfillment_status = 'processing')
    or (v_current_status = 'processing' and p_new_fulfillment_status = 'packed')
    or (
      v_current_status = 'packed'
      and p_new_fulfillment_status = 'shipped'
      and exists (
        select 1 from public.order_shipments sh
         where sh.order_id = p_order_id
           and nullif(btrim(sh.awb_code), '') is not null
           and lower(coalesce(sh.status,'')) not in ('failed','cancelled','canceled')
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'Invalid fulfilment transition or shipment AWB missing';
  end if;

  update public.orders
     set fulfillment_status = p_new_fulfillment_status
   where id = p_order_id;

  -- Existing order-update triggers atomically stage customer email/WhatsApp
  -- events for shipped/out_for_delivery/delivered transitions, with dispatch
  -- still subject to the existing provider/global launch gates.
  return jsonb_build_object(
    'order_id', p_order_id,
    'previous_fulfillment_status', v_current_status,
    'fulfillment_status', p_new_fulfillment_status,
    'notification_staged_by_order_trigger', p_new_fulfillment_status = 'shipped'
  );
end;
$function$;

revoke all on function public.seller_update_order_fulfillment(bigint,text) from public, anon;
grant execute on function public.seller_update_order_fulfillment(bigint,text) to authenticated;

     and (line.item->>'id')::bigint = s.approved_product_id
    where o.id = p_order_id
  ) into v_owns_order;

  if not v_owns_order then
    raise exception using errcode = '42501', message = 'Order does not contain an approved product owned by this seller';
  end if;

  if not (
    (v_current_status = 'ordered' and p_new_fulfillment_status = 'processing')
    or (v_current_status = 'processing' and p_new_fulfillment_status = 'packed')
    or (
      v_current_status = 'packed'
      and p_new_fulfillment_status = 'shipped'
      and exists (
        select 1 from public.order_shipments sh
         where sh.order_id = p_order_id
           and nullif(btrim(sh.awb_code), '') is not null
           and lower(coalesce(sh.status,'')) not in ('failed','cancelled','canceled')
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'Invalid fulfilment transition or shipment AWB missing';
  end if;

  update public.orders
     set fulfillment_status = p_new_fulfillment_status
   where id = p_order_id;

  -- Existing order-update triggers atomically stage customer email/WhatsApp
  -- events for shipped/out_for_delivery/delivered transitions, with dispatch
  -- still subject to the existing provider/global launch gates.
  return jsonb_build_object(
    'order_id', p_order_id,
    'previous_fulfillment_status', v_current_status,
    'fulfillment_status', p_new_fulfillment_status,
    'notification_staged_by_order_trigger', p_new_fulfillment_status = 'shipped'
  );
end;
$function$;

revoke all on function public.seller_update_order_fulfillment(bigint,text) from public, anon;
grant execute on function public.seller_update_order_fulfillment(bigint,text) to authenticated;

-- Seller-owned, guarded fulfilment transitions for the production order ledger.
-- This migration does not alter existing order rows; it expands the allowed status set.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status = ANY (ARRAY[
    'ordered'::text, 'processing'::text, 'packed'::text, 'shipped'::text,
    'out_for_delivery'::text, 'delivered'::text, 'cancelled'::text
  ]));

CREATE OR REPLACE FUNCTION public.seller_update_order_fulfillment(
  p_order_id bigint,
  p_new_fulfillment_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_current_status text;
  v_owns_order boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '28000', message = 'Authentication required';
  END IF;

  IF p_order_id IS NULL OR p_new_fulfillment_status NOT IN ('processing', 'packed', 'shipped') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Unsupported order fulfilment transition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.seller_profiles sp
     WHERE sp.user_id = v_uid
       AND sp.status = 'active'
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Active seller profile required';
  END IF;

  -- Lock the order before authorization and transition validation.
  SELECT o.fulfillment_status
    INTO v_current_status
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'Order not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.orders o
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) AS line(item)
      JOIN public.seller_product_submissions s
        ON s.seller_id = v_uid
       AND s.approved_product_id IS NOT NULL
       AND CASE
             WHEN coalesce(line.item->>'id', '') ~ '^[0-9]+$'
             THEN (line.item->>'id')::bigint
             ELSE NULL
           END = s.approved_product_id
     WHERE o.id = p_order_id
  ) INTO v_owns_order;

  IF NOT v_owns_order THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Order does not contain an approved product owned by this seller';
  END IF;

  IF NOT (
    (v_current_status = 'ordered' AND p_new_fulfillment_status = 'processing')
    OR (v_current_status = 'processing' AND p_new_fulfillment_status = 'packed')
    OR (
      v_current_status = 'packed'
      AND p_new_fulfillment_status = 'shipped'
      AND EXISTS (
        SELECT 1
          FROM public.order_shipments sh
         WHERE sh.order_id = p_order_id
           AND nullif(btrim(sh.awb_code), '') IS NOT NULL
           AND lower(coalesce(sh.status, '')) NOT IN ('failed', 'cancelled', 'canceled')
      )
    )
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Invalid fulfilment transition or shipment AWB missing';
  END IF;

  UPDATE public.orders
     SET fulfillment_status = p_new_fulfillment_status
   WHERE id = p_order_id;

  -- Existing order-update triggers may stage notifications; provider/global
  -- launch gates remain responsible for whether any external message is sent.
  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'previous_fulfillment_status', v_current_status,
    'fulfillment_status', p_new_fulfillment_status,
    'notification_staged_by_order_trigger', p_new_fulfillment_status = 'shipped'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_update_order_fulfillment(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_update_order_fulfillment(bigint, text) TO authenticated;

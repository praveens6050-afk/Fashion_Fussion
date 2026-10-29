-- Run after seller-fulfillment-fixture.sql and the migration, against an isolated database only.
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;

DO $$
DECLARE result jsonb;
BEGIN
  result := public.seller_update_order_fulfillment(1, 'processing');
  IF result->>'fulfillment_status' <> 'processing' OR result->>'previous_fulfillment_status' <> 'ordered' THEN
    RAISE EXCEPTION 'ordered -> processing returned unexpected result: %', result;
  END IF;

  result := public.seller_update_order_fulfillment(1, 'packed');
  IF result->>'fulfillment_status' <> 'packed' THEN
    RAISE EXCEPTION 'processing -> packed returned unexpected result: %', result;
  END IF;

  BEGIN
    PERFORM public.seller_update_order_fulfillment(1, 'shipped');
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'shipped unexpectedly succeeded without AWB';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.seller_update_order_fulfillment(2, 'processing');
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'seller updated another seller order';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.seller_update_order_fulfillment(1, 'delivered');
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'seller directly set delivered status';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END $$;

RESET ROLE;
INSERT INTO public.order_shipments(order_id, awb_code, status) VALUES (1, 'TEST-AWB-001', 'booked');

SET ROLE authenticated;
DO $$
DECLARE result jsonb;
BEGIN
  result := public.seller_update_order_fulfillment(1, 'shipped');
  IF result->>'fulfillment_status' <> 'shipped' OR result->>'notification_staged_by_order_trigger' <> 'true' THEN
    RAISE EXCEPTION 'packed -> shipped with AWB returned unexpected result: %', result;
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT fulfillment_status FROM public.orders WHERE id = 1) <> 'shipped' THEN
    RAISE EXCEPTION 'final order status was not persisted';
  END IF;
END $$;

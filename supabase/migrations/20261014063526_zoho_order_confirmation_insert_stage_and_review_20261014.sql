-- Inserts for already-confirmed COD orders need an initial outbox event.
-- Only stages a review item; no network call, automation, or historical backfill.
CREATE OR REPLACE FUNCTION public.stage_zoho_email_on_order_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF new.payment_method='cod' AND new.status IN ('cod_pending','cod_collected')
 THEN
  PERFORM public.stage_zoho_order_email_event(new.id,'order_confirmed');
 END IF;
 RETURN new;
END
$fn$;
DROP TRIGGER IF EXISTS trg_stage_zoho_email_order_insert ON public.orders;
CREATE TRIGGER trg_stage_zoho_email_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.stage_zoho_email_on_order_insert();

-- Manual/controlled readiness transition. Only authorized service role can approve,
-- only the order_confirmed event, only recent verified orders with confirmed recipient.
CREATE OR REPLACE FUNCTION public.approve_zoho_order_confirmation(p_order_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_count integer;
BEGIN
 IF p_order_id IS NULL OR p_order_id<=0 THEN RETURN false; END IF;
 UPDATE public.zoho_order_email_outbox ob
    SET status='ready', updated_at=now()
   FROM public.orders ord
   JOIN auth.users buyer ON buyer.id=ord.user_id
  WHERE ob.order_id=ord.id AND ord.id=p_order_id
    AND ob.event_type='order_confirmed'
    AND ob.provider='zoho_mail'
    AND ob.status='pending_review'
    AND ob.attempt_count=0 AND ob.sent_at IS NULL AND ob.provider_message_id IS NULL
    AND ob.created_at BETWEEN now()-interval '24 hours' AND now()
    AND ord.created_at BETWEEN now()-interval '24 hours' AND now()+interval '5 minutes'
    AND ord.fulfillment_status <> 'cancelled'
    AND buyer.email_confirmed_at IS NOT NULL
    AND lower(btrim(buyer.email))=lower(btrim(ord.customer_email))
    AND nullif(btrim(ord.customer_email),'') IS NOT NULL
    AND nullif(btrim(ord.customer_name),'') IS NOT NULL
    AND nullif(btrim(ord.display_order_id),'') IS NOT NULL
    AND (
      (ord.payment_method='prepaid'
       AND ord.status='paid' AND ord.payment_verified_at IS NOT NULL)
      OR (ord.payment_method='cod' AND ord.status IN ('cod_pending','cod_collected'))
    );
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END
$fn$;
REVOKE ALL ON FUNCTION public.approve_zoho_order_confirmation(bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_zoho_order_confirmation(bigint) TO service_role;
COMMENT ON FUNCTION public.approve_zoho_order_confirmation(bigint) IS
 'Service-only approval of recent, verified order-confirmation outbox event. No network call or email send.';

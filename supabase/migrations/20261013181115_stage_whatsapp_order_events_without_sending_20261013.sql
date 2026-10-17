
create or replace function public.stage_whatsapp_order_event(p_order_id bigint,p_event_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order public.orders%rowtype;
  v_consent public.whatsapp_order_consents%rowtype;
  v_count integer;
begin
  if p_event_type not in ('order_confirmed','shipped','out_for_delivery','delivered') then return false; end if;
  select * into v_order from public.orders where id=p_order_id;
  if not found or v_order.user_id is null or v_order.fulfillment_status='cancelled'
     or v_order.status in ('created','creating','expired','cancelled','cod_cancelled','payment_failed',
                           'refund_pending','refund_initiated','refund_failed','refunded')
  then return false; end if;

  select * into v_consent from public.whatsapp_order_consents
  where order_id=p_order_id and user_id=v_order.user_id and revoked_at is null;
  if not found then return false; end if;

  if not exists (
    select 1 from public.whatsapp_contact_consents c
    where c.phone_e164=v_consent.phone_e164
      and c.purpose='transactional' and c.status='opted_in'
      and c.consented_at is not null and c.revoked_at is null
  ) then return false; end if;

  if p_event_type='order_confirmed' then
    if v_order.status <> 'paid' or v_order.payment_verified_at is null
       or v_order.fulfillment_status <> 'ordered'
       or v_order.created_at < now() - interval '24 hours'
    then return false; end if;
  else
    if v_order.status not in ('paid','cod_pending','cod_collected')
       or v_order.fulfillment_status <> p_event_type
       or v_order.fulfillment_updated_at < v_consent.consented_at
    then return false; end if;
    if p_event_type='delivered' and v_order.payment_method='cod'
       and v_order.status <> 'cod_collected'
    then return false; end if;
    if not exists (
      select 1 from public.order_shipments s
      where s.order_id = p_order_id and s.direction='forward'
        and nullif(btrim(s.awb_code),'') is not null
    ) then return false; end if;
  end if;

  insert into public.whatsapp_order_notification_outbox
    (order_id,event_type,status,template_name)
  values (p_order_id,p_event_type,'pending_review','order_status_update')
  on conflict (order_id,event_type) do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$fn$;
revoke all on function public.stage_whatsapp_order_event(bigint,text) from public,anon,authenticated;
grant execute on function public.stage_whatsapp_order_event(bigint,text) to service_role;
comment on function public.stage_whatsapp_order_event(bigint,text) is
'Stages real verified status transitions with per-order opt-in and duplicate-safe outbox; NEVER sends WhatsApp messages.';

create or replace function public.enqueue_whatsapp_event_on_consent()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if new.revoked_at is null then
    perform public.stage_whatsapp_order_event(new.order_id,'order_confirmed');
  end if;
  return new;
end;
$fn$;
revoke all on function public.enqueue_whatsapp_event_on_consent() from public,anon,authenticated;
drop trigger if exists trg_stage_whatsapp_order_on_consent on public.whatsapp_order_consents;
create trigger trg_stage_whatsapp_order_on_consent
after insert or update of consented_at,revoked_at on public.whatsapp_order_consents
for each row execute function public.enqueue_whatsapp_event_on_consent();

create or replace function public.enqueue_whatsapp_event_on_order_change()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if old.status is distinct from new.status
      or old.payment_verified_at is distinct from new.payment_verified_at
  then
    perform public.stage_whatsapp_order_event(new.id,'order_confirmed');
  end if;
  if old.fulfillment_status is distinct from new.fulfillment_status
      and new.fulfillment_status in ('shipped','out_for_delivery','delivered')
  then
    perform public.stage_whatsapp_order_event(new.id,new.fulfillment_status);
  end if;
  return new;
end;
$fn$;
revoke all on function public.enqueue_whatsapp_event_on_order_change() from public,anon,authenticated;
drop trigger if exists trg_stage_whatsapp_order_on_change on public.orders;
create trigger trg_stage_whatsapp_order_on_change
after update of status,payment_verified_at,fulfillment_status on public.orders
for each row execute function public.enqueue_whatsapp_event_on_order_change();

create or replace function public.enqueue_whatsapp_event_on_shipment_change()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
declare v_state text;
begin
  if new.direction <> 'forward' or nullif(btrim(new.awb_code),'') is null then return new; end if;
  select fulfillment_status into v_state from public.orders where id=new.order_id;
  if v_state in ('shipped','out_for_delivery','delivered') then
    perform public.stage_whatsapp_order_event(new.order_id,v_state);
  end if;
  return new;
end;
$fn$;
revoke all on function public.enqueue_whatsapp_event_on_shipment_change() from public,anon,authenticated;
drop trigger if exists trg_stage_whatsapp_order_on_shipment on public.order_shipments;
create trigger trg_stage_whatsapp_order_on_shipment
after insert or update of awb_code,status,provider_status on public.order_shipments
for each row execute function public.enqueue_whatsapp_event_on_shipment_change();


create table if not exists public.zoho_order_email_outbox (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in (
    'order_confirmed','payment_successful','shipped','out_for_delivery','delivered'
  )),
  provider text not null default 'zoho_mail' check (provider = 'zoho_mail'),
  status text not null default 'pending_review'
    check (status in ('pending_review','ready','sending','sent','failed','blocked')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 25),
  provider_message_id text,
  last_error_code text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zoho_order_email_once_per_order_event unique(order_id,event_type)
);
create index if not exists zoho_order_email_outbox_status_idx
 on public.zoho_order_email_outbox(status,created_at);
alter table public.zoho_order_email_outbox enable row level security;
revoke all on table public.zoho_order_email_outbox from public,anon,authenticated;
grant select,insert,update,delete on table public.zoho_order_email_outbox to service_role;
grant usage,select on sequence public.zoho_order_email_outbox_id_seq to service_role;

create or replace function public.stage_zoho_order_email_event(
  p_order_id bigint, p_event_type text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_order public.orders%rowtype;
 v_email text;
 v_confirmed_at timestamptz;
 v_count integer;
begin
 if p_event_type not in ('order_confirmed','payment_successful','shipped','out_for_delivery','delivered')
 then return false; end if;
 select * into v_order from public.orders where id=p_order_id;
 if not found or v_order.user_id is null
    or v_order.fulfillment_status='cancelled'
    or v_order.status in ('creating','created','expired','cancelled','cod_cancelled','payment_failed',
                          'refund_pending','refund_initiated','refund_failed','refunded')
 then return false; end if;

 select u.email,u.email_confirmed_at into v_email,v_confirmed_at
 from auth.users u where u.id=v_order.user_id;
 if v_confirmed_at is null or nullif(btrim(v_email),'') is null
    or lower(btrim(v_email)) <> lower(btrim(coalesce(v_order.customer_email,'')))
 then return false; end if;

 if p_event_type='order_confirmed' then
   if not (
     v_order.status in ('cod_pending','cod_collected')
     or (v_order.status='paid' and v_order.payment_verified_at is not null)
   ) or v_order.created_at < now()-interval '24 hours'
   then return false; end if;
 elsif p_event_type='payment_successful' then
   if not (
     (v_order.status='paid' and v_order.payment_method='prepaid'
      and v_order.payment_verified_at is not null)
     or (v_order.status='cod_collected' and v_order.payment_method='cod')
   ) then return false; end if;
 else
   if v_order.status not in ('paid','cod_pending','cod_collected')
       or v_order.fulfillment_status <> p_event_type
   then return false; end if;
   if p_event_type='delivered' and v_order.payment_method='cod'
       and v_order.status <> 'cod_collected'
   then return false; end if;
   if not exists (
     select 1 from public.order_shipments s
     where s.order_id=v_order.id
       and s.direction='forward'
       and nullif(btrim(s.awb_code),'') is not null
   ) then return false; end if;
 end if;

 insert into public.zoho_order_email_outbox(order_id,event_type,status)
 values(v_order.id,p_event_type,'pending_review')
 on conflict(order_id,event_type) do nothing;
 get diagnostics v_count=row_count;
 return v_count>0;
end;
$function$;
revoke all on function public.stage_zoho_order_email_event(bigint,text)
 from public,anon,authenticated;
grant execute on function public.stage_zoho_order_email_event(bigint,text) to service_role;
comment on function public.stage_zoho_order_email_event(bigint,text) is
 'Stage verified paid/COD/shipping email events with confirmed auth recipient. Never send Zoho email.';

create or replace function public.stage_zoho_email_on_order_change()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
 if old.status is distinct from new.status
    or old.payment_verified_at is distinct from new.payment_verified_at
 then
   perform public.stage_zoho_order_email_event(new.id,'order_confirmed');
   perform public.stage_zoho_order_email_event(new.id,'payment_successful');
 end if;
 if old.fulfillment_status is distinct from new.fulfillment_status
    and new.fulfillment_status in ('shipped','out_for_delivery','delivered')
 then
   perform public.stage_zoho_order_email_event(new.id,new.fulfillment_status);
 end if;
 return new;
end;
$function$;
revoke all on function public.stage_zoho_email_on_order_change() from public,anon,authenticated;
drop trigger if exists trg_stage_zoho_email_order on public.orders;
create trigger trg_stage_zoho_email_order
after update of status,payment_verified_at,fulfillment_status on public.orders
for each row execute function public.stage_zoho_email_on_order_change();

create or replace function public.stage_zoho_email_on_shipment_change()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_state text;
begin
 if new.direction <> 'forward' or nullif(btrim(new.awb_code),'') is null then return new; end if;
 select o.fulfillment_status into v_state
 from public.orders o where o.id=new.order_id;
 if v_state in ('shipped','out_for_delivery','delivered') then
   perform public.stage_zoho_order_email_event(new.order_id,v_state);
 end if;
 return new;
end;
$function$;
revoke all on function public.stage_zoho_email_on_shipment_change() from public,anon,authenticated;
drop trigger if exists trg_stage_zoho_email_shipment on public.order_shipments;
create trigger trg_stage_zoho_email_shipment
after insert or update of awb_code,status,provider_status
on public.order_shipments
for each row execute function public.stage_zoho_email_on_shipment_change();

comment on table public.zoho_order_email_outbox is
 'Zoho transactional email staging only, not a live sender. No automatic backfill or cron. A sending worker requires independent approval and production testing.';


create table if not exists public.whatsapp_order_consents (
  order_id bigint primary key references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source text not null default 'checkout_checkbox' check (source='checkout_checkbox'),
  consented_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_order_consents_user_id_idx on public.whatsapp_order_consents(user_id);
alter table public.whatsapp_order_consents enable row level security;
revoke all on table public.whatsapp_order_consents from public, anon, authenticated;
grant select,insert,update,delete on table public.whatsapp_order_consents to service_role;
comment on table public.whatsapp_order_consents is
  'Per-order explicit customer opt-in for utility WhatsApp updates. Only secure server RPC can write; no auto notification sends.';

create or replace function public.record_checkout_whatsapp_consent(p_order_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $function$
declare
 v_user uuid := auth.uid();
 v_order public.orders%rowtype;
 v_digits text;
 v_phone text;
 v_time timestamptz := now();
begin
 if v_user is null then
   raise exception 'Authentication required' using errcode='42501';
 end if;
 select * into v_order from public.orders
 where id=p_order_id and user_id=v_user;
 if not found then
   raise exception 'Order not found or not owned by this account' using errcode='42501';
 end if;
 if not (
   (v_order.status='paid' and v_order.payment_verified_at is not null)
   or v_order.status in ('cod_pending','cod_collected')
 ) or v_order.fulfillment_status='cancelled' then
   raise exception 'This order is not confirmed for opt-in' using errcode='22023';
 end if;
 v_digits:=regexp_replace(coalesce(v_order.customer_phone,''),'[^0-9]','','g');
 if v_digits ~ '^[6-9][0-9]{9}$' then
   v_phone:='+91'||v_digits;
 elsif v_digits ~ '^91[6-9][0-9]{9}$' then
   v_phone:='+'||v_digits;
 elsif left(btrim(coalesce(v_order.customer_phone,'')),1)='+' and v_digits ~ '^[1-9][0-9]{7,14}$' then
   v_phone:='+'||v_digits;
 else
   raise exception 'Order has no valid WhatsApp phone number' using errcode='22023';
 end if;

 insert into public.whatsapp_order_consents as current_consent
   (order_id,user_id,phone_e164,source,consented_at,revoked_at,updated_at)
 values
   (v_order.id,v_user,v_phone,'checkout_checkbox',v_time,null,v_time)
 on conflict(order_id) do update set
   phone_e164=excluded.phone_e164,
   consented_at=excluded.consented_at,
   revoked_at=null,
   updated_at=v_time
 where current_consent.user_id=v_user;

 insert into public.whatsapp_contact_consents as ledger
   (phone_e164,purpose,status,source,proof_reference,consented_at,revoked_at,updated_at)
 values
   (v_phone,'transactional','opted_in','checkout_checkbox','order:'||v_order.id::text,v_time,null,v_time)
 on conflict(phone_e164,purpose) do update set
   status='opted_in',source='checkout_checkbox',
   proof_reference=excluded.proof_reference,consented_at=v_time,revoked_at=null,updated_at=v_time;

 return jsonb_build_object('ok',true,'order_id',v_order.id,'phone_hint',right(v_phone,4),'consented_at',v_time);
end;
$function$;
revoke all on function public.record_checkout_whatsapp_consent(bigint) from public,anon,authenticated;
grant execute on function public.record_checkout_whatsapp_consent(bigint) to authenticated;
comment on function public.record_checkout_whatsapp_consent(bigint) is
  'Only the order owner can explicitly grant WhatsApp transactional updates after successful COD placement or verified prepaid payment. No sending.';


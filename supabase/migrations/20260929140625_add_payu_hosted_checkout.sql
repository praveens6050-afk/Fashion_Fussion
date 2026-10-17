begin;

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists payu_txnid text,
  add column if not exists payu_mihpayid text,
  add column if not exists payu_unmapped_status text;

update public.orders
set payment_provider = 'razorpay'
where payment_provider is null
  and payment_method = 'prepaid'
  and razorpay_order_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_provider_check'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_check
      check (payment_provider is null or payment_provider in ('razorpay','payu'));
  end if;
end $$;

create unique index if not exists orders_payu_txnid_uidx
  on public.orders(payu_txnid)
  where payu_txnid is not null;

create index if not exists orders_payment_provider_status_idx
  on public.orders(payment_provider, status, created_at desc);

create or replace function public.finalize_payu_checkout_order(
  p_order_id bigint,
  p_user_id uuid,
  p_txnid text,
  p_mihpayid text,
  p_unmapped_status text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o
  from public.orders
  where id = p_order_id and user_id = p_user_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if o.payment_method <> 'prepaid' then raise exception 'Order is not prepaid'; end if;
  if coalesce(o.payment_provider, '') <> 'payu' then raise exception 'Order is not a PayU order'; end if;
  if nullif(trim(coalesce(p_txnid, '')), '') is null then raise exception 'PayU transaction ID is required'; end if;
  if o.payu_txnid is null or o.payu_txnid <> p_txnid then raise exception 'PayU transaction ID does not match order'; end if;
  if nullif(trim(coalesce(p_mihpayid, '')), '') is null then raise exception 'PayU payment ID is required'; end if;

  if o.status = 'paid' then
    if o.payu_mihpayid is not null and o.payu_mihpayid <> p_mihpayid then
      raise exception 'Order is linked to a different PayU payment';
    end if;
    return;
  end if;

  if o.status not in ('creating', 'created') then
    raise exception 'Order is not in an active checkout state';
  end if;

  perform public.finalize_order_promotions(o.id, p_user_id);

  update public.orders
  set payu_mihpayid = p_mihpayid,
      payu_unmapped_status = nullif(trim(coalesce(p_unmapped_status, '')), ''),
      status = 'paid',
      payment_verified_at = now(),
      payment_source = nullif(trim(coalesce(p_source, '')), '')
  where id = o.id;
end;
$$;

revoke execute on function public.finalize_payu_checkout_order(bigint,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.finalize_payu_checkout_order(bigint,uuid,text,text,text,text)
  to service_role;

notify pgrst, 'reload schema';
commit;

create unique index if not exists coupon_redemptions_coupon_order_uidx
  on public.coupon_redemptions(coupon_id, order_id)
  where order_id is not null;

alter table public.promotion_reservations
  alter column expires_at set default (now() + interval '24 hours');

update public.promotion_reservations
set expires_at = greatest(expires_at, created_at + interval '24 hours'),
    updated_at = now()
where status = 'reserved';

create or replace function public.finalize_order_promotions(p_order_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select *
    from public.promotion_reservations
    where order_id = p_order_id
      and user_id = p_user_id
      and status = 'reserved'
    for update
  loop
    if r.kind = 'coupon' then
      insert into public.coupon_redemptions(coupon_id, user_id, order_id, discount_amount)
      values(r.coupon_id, p_user_id, p_order_id, r.amount)
      on conflict (coupon_id, order_id) where order_id is not null do nothing;
    elsif r.kind = 'gift_card' then
      insert into public.gift_card_redemptions(gift_card_code_id, user_id, order_id, amount)
      values(r.gift_card_code_id, p_user_id, p_order_id, r.amount)
      on conflict (gift_card_code_id, order_id) where order_id is not null do nothing;
    end if;

    update public.promotion_reservations
    set status = 'consumed', updated_at = now()
    where id = r.id;
  end loop;
end;
$$;

revoke all on function public.finalize_order_promotions(bigint, uuid) from public, anon, authenticated;
grant execute on function public.finalize_order_promotions(bigint, uuid) to service_role;
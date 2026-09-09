create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false)
$$;

revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to authenticated;

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and is_admin = public.current_user_is_admin());

drop policy if exists "Customers can create support requests" on public.customer_support_requests;
create policy "Customers can create support requests"
on public.customer_support_requests for insert
to authenticated
with check (user_id = (select auth.uid()));

alter table public.products
  add constraint products_cost_nonnegative_check check (cost >= 0),
  add constraint products_price_nonnegative_check check (price >= 0),
  add constraint products_rating_range_check check (rating is null or (rating >= 0 and rating <= 5)),
  add constraint products_reviews_nonnegative_check check (reviews is null or reviews >= 0);

alter table public.orders
  add constraint orders_total_amount_nonnegative_check check (total_amount >= 0),
  add constraint orders_coupon_discount_nonnegative_check check (coupon_discount >= 0),
  add constraint orders_gift_card_discount_nonnegative_check check (gift_card_discount >= 0),
  add constraint orders_checkout_key_format_check check (checkout_key is null or checkout_key ~ '^[A-Za-z0-9_-]{16,100}$'),
  add constraint orders_cod_flag_consistency_check check ((payment_method = 'cod' and cod_fee_non_refundable = true) or (payment_method = 'prepaid' and cod_fee_non_refundable = false));

alter table public.customer_addresses
  add constraint customer_addresses_nonblank_check check (
    btrim(full_name) <> '' and btrim(phone) <> '' and btrim(address_line1) <> '' and
    btrim(city) <> '' and btrim(state) <> '' and btrim(postal_code) <> '' and btrim(country) <> ''
  ),
  add constraint customer_addresses_india_pin_check check (
    lower(btrim(country)) <> 'india' or postal_code ~ '^[0-9]{6}$'
  );

alter table public.coupons
  add constraint coupons_usage_limit_positive_check check (usage_limit is null or usage_limit > 0),
  add constraint coupons_max_discount_nonnegative_check check (max_discount is null or max_discount >= 0),
  add constraint coupons_date_order_check check (expires_at is null or expires_at > starts_at);

alter table public.gift_card_codes
  add constraint gift_card_codes_balance_not_above_initial_check check (balance <= initial_balance);

alter table public.customer_support_requests
  add constraint customer_support_requests_nonblank_check check (
    btrim(customer_name) <> '' and btrim(customer_phone) <> '' and btrim(issue) <> ''
  );

alter table public.customer_support_messages
  add constraint customer_support_messages_nonblank_check check (btrim(message) <> '');

alter policy "Users can insert own profile" on public.profiles with check ((select auth.uid()) = id);
alter policy "Users can update own profile" on public.profiles using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
alter policy "Users can view own profile" on public.profiles using ((select auth.uid()) = id);

alter policy "Users can view own orders" on public.orders using ((select auth.uid()) = user_id);
alter policy "Admins can update order fulfillment" on public.orders using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Admins can view all orders" on public.orders using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));

alter policy "Admins can manage products" on public.products using (exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.is_admin = true)) with check (exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.is_admin = true));

alter policy "Customers can delete own addresses" on public.customer_addresses using (user_id = (select auth.uid()));
alter policy "Customers can insert own addresses" on public.customer_addresses with check (user_id = (select auth.uid()));
alter policy "Customers can update own addresses" on public.customer_addresses using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "Customers can view own addresses" on public.customer_addresses using (user_id = (select auth.uid()));

alter policy "wishlist_delete_own" on public.customer_wishlist using ((select auth.uid()) = user_id);
alter policy "wishlist_insert_own" on public.customer_wishlist with check ((select auth.uid()) = user_id);
alter policy "wishlist_select_own" on public.customer_wishlist using ((select auth.uid()) = user_id);

alter policy "Users can view own coupon redemptions" on public.coupon_redemptions using ((select auth.uid()) = user_id);
alter policy "Admins can view coupon redemptions" on public.coupon_redemptions using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Admins can manage coupons" on public.coupons using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));

alter policy "Admins can manage gift card codes" on public.gift_card_codes using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Admins can view gift card redemptions" on public.gift_card_redemptions using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Users can view own gift card redemptions" on public.gift_card_redemptions using ((select auth.uid()) = user_id);
alter policy "Admins can manage gift cards" on public.gift_cards using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));

alter policy "Admins can send support messages" on public.customer_support_messages with check ((sender_type = 'admin') and (sender_user_id = (select auth.uid())) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Admins can view support messages" on public.customer_support_messages using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Customers can send support messages" on public.customer_support_messages with check ((sender_type = 'customer') and (sender_user_id = (select auth.uid())) and exists (select 1 from public.customer_support_requests r where r.id = customer_support_messages.request_id and r.user_id = (select auth.uid()) and r.status = 'accepted'));
alter policy "Customers can view own support messages" on public.customer_support_messages using (exists (select 1 from public.customer_support_requests r where r.id = customer_support_messages.request_id and r.user_id = (select auth.uid())));

alter policy "Admins can update support requests" on public.customer_support_requests using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Admins can view support requests" on public.customer_support_requests using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
alter policy "Customers can create support requests" on public.customer_support_requests with check ((user_id = (select auth.uid())) or user_id is null);
alter policy "Customers can update own pending support requests" on public.customer_support_requests using ((user_id = (select auth.uid())) and status = 'pending') with check (user_id = (select auth.uid()));
alter policy "Customers can view own support requests" on public.customer_support_requests using (user_id = (select auth.uid()));
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

grant select on table public.products to anon;

grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.customer_addresses to authenticated;
grant select, insert, update on table public.customer_support_requests to authenticated;
grant select, insert on table public.customer_support_messages to authenticated;
grant select, insert, delete on table public.customer_wishlist to authenticated;
grant select, insert, update, delete on table public.coupons to authenticated;
grant select, insert, update, delete on table public.gift_cards to authenticated;
grant select, insert, update, delete on table public.gift_card_codes to authenticated;
grant select on table public.coupon_redemptions to authenticated;
grant select on table public.gift_card_redemptions to authenticated;
grant select, update on table public.orders to authenticated;

grant usage on sequence public.products_id_seq to authenticated;
grant usage on sequence public.customer_addresses_id_seq to authenticated;
grant usage on sequence public.customer_support_requests_id_seq to authenticated;
grant usage on sequence public.customer_support_messages_id_seq to authenticated;
grant usage on sequence public.customer_wishlist_id_seq to authenticated;
grant usage on sequence public.coupons_id_seq to authenticated;
grant usage on sequence public.gift_cards_id_seq to authenticated;
grant usage on sequence public.gift_card_codes_id_seq to authenticated;
begin;

revoke execute on function public.admin_list_seller_finance_reviews(text,text,integer,integer) from public, anon;
revoke execute on function public.admin_prepare_seller_payout(bigint) from public, anon;
revoke execute on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) from public, anon;
revoke execute on function public.admin_review_seller_finance(uuid,text,text,text) from public, anon;
revoke execute on function public.cleanup_seller_e2e_submissions() from public, anon;
revoke execute on function public.save_seller_pickup_location(bigint,text,text,text,text,text,text,text,text,text,boolean) from public, anon;
revoke execute on function public.submit_seller_verification() from public, anon;

grant execute on function public.admin_list_seller_finance_reviews(text,text,integer,integer) to authenticated;
grant execute on function public.admin_prepare_seller_payout(bigint) to authenticated;
grant execute on function public.admin_record_seller_payout_result(bigint,text,text,text,text,jsonb) to authenticated;
grant execute on function public.admin_review_seller_finance(uuid,text,text,text) to authenticated;
grant execute on function public.cleanup_seller_e2e_submissions() to authenticated;
grant execute on function public.save_seller_pickup_location(bigint,text,text,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.submit_seller_verification() to authenticated;

revoke all privileges on table public.order_inventory_reservations from anon;
revoke insert, update, delete, truncate, references, trigger on table public.order_inventory_reservations from authenticated;
grant select on table public.order_inventory_reservations to authenticated;

commit;

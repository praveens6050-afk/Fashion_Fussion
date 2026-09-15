begin;

revoke execute on function public.commit_order_inventory(bigint) from public, anon, authenticated;
revoke execute on function public.release_order_inventory(bigint) from public, anon, authenticated;
revoke execute on function public.reserve_order_inventory(bigint) from public, anon, authenticated;
revoke execute on function public.restock_cancelled_order_inventory(bigint) from public, anon, authenticated;
grant execute on function public.commit_order_inventory(bigint) to service_role;
grant execute on function public.release_order_inventory(bigint) to service_role;
grant execute on function public.reserve_order_inventory(bigint) to service_role;
grant execute on function public.restock_cancelled_order_inventory(bigint) to service_role;

revoke execute on function public.accept_bulk_quote(bigint) from public, anon;
revoke execute on function public.create_bulk_quote_request(bigint, integer, text) from public, anon;
revoke execute on function public.create_return_request(bigint, integer, text, integer, text, text) from public, anon;
revoke execute on function public.admin_set_variant_inventory(bigint, integer, integer, text) from public, anon;
revoke execute on function public.finalize_bulk_quote(bigint, jsonb, timestamp with time zone, text) from public, anon;
grant execute on function public.accept_bulk_quote(bigint) to authenticated, service_role;
grant execute on function public.create_bulk_quote_request(bigint, integer, text) to authenticated, service_role;
grant execute on function public.create_return_request(bigint, integer, text, integer, text, text) to authenticated, service_role;
grant execute on function public.admin_set_variant_inventory(bigint, integer, integer, text) to authenticated, service_role;
grant execute on function public.finalize_bulk_quote(bigint, jsonb, timestamp with time zone, text) to authenticated, service_role;

commit;

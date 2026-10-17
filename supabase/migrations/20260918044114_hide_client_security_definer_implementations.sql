begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

alter function public.accept_bulk_quote(bigint) set schema private;
alter function public.admin_set_variant_inventory(bigint,integer,integer,text) set schema private;
alter function public.create_bulk_quote_request(bigint,integer,text) set schema private;
alter function public.create_return_request(bigint,integer,text,integer,text,text) set schema private;
alter function public.finalize_bulk_quote(bigint,jsonb,timestamptz,text) set schema private;
alter function public.get_variant_availability(bigint) set schema private;

revoke all on function private.accept_bulk_quote(bigint) from public, anon, authenticated;
revoke all on function private.admin_set_variant_inventory(bigint,integer,integer,text) from public, anon, authenticated;
revoke all on function private.create_bulk_quote_request(bigint,integer,text) from public, anon, authenticated;
revoke all on function private.create_return_request(bigint,integer,text,integer,text,text) from public, anon, authenticated;
revoke all on function private.finalize_bulk_quote(bigint,jsonb,timestamptz,text) from public, anon, authenticated;
revoke all on function private.get_variant_availability(bigint) from public, anon, authenticated;

grant execute on function private.accept_bulk_quote(bigint) to authenticated, service_role;
grant execute on function private.admin_set_variant_inventory(bigint,integer,integer,text) to authenticated, service_role;
grant execute on function private.create_bulk_quote_request(bigint,integer,text) to authenticated, service_role;
grant execute on function private.create_return_request(bigint,integer,text,integer,text,text) to authenticated, service_role;
grant execute on function private.finalize_bulk_quote(bigint,jsonb,timestamptz,text) to authenticated, service_role;
grant execute on function private.get_variant_availability(bigint) to anon, authenticated, service_role;

create function public.accept_bulk_quote(p_quote_id bigint)
returns table(quote_id bigint, status text, quoted_total numeric, valid_until timestamptz, accepted_at timestamptz)
language sql
security invoker
set search_path = ''
as $$ select * from private.accept_bulk_quote(p_quote_id); $$;
revoke all on function public.accept_bulk_quote(bigint) from public, anon;
grant execute on function public.accept_bulk_quote(bigint) to authenticated, service_role;

create function public.admin_set_variant_inventory(p_variant_id bigint, p_on_hand integer, p_reorder_level integer default null, p_note text default null)
returns table(on_hand integer, reserved integer, reorder_level integer)
language sql
security invoker
set search_path = ''
as $$ select * from private.admin_set_variant_inventory(p_variant_id,p_on_hand,p_reorder_level,p_note); $$;
revoke all on function public.admin_set_variant_inventory(bigint,integer,integer,text) from public, anon;
grant execute on function public.admin_set_variant_inventory(bigint,integer,integer,text) to authenticated, service_role;

create function public.create_bulk_quote_request(p_product_id bigint, p_quantity integer, p_customer_note text default null)
returns table(quote_id bigint, status text)
language sql
security invoker
set search_path = ''
as $$ select * from private.create_bulk_quote_request(p_product_id,p_quantity,p_customer_note); $$;
revoke all on function public.create_bulk_quote_request(bigint,integer,text) from public, anon;
grant execute on function public.create_bulk_quote_request(bigint,integer,text) to authenticated, service_role;

create function public.create_return_request(p_order_id bigint, p_item_index integer, p_request_type text, p_quantity integer, p_reason text, p_requested_size text default null)
returns public.return_requests
language sql
security invoker
set search_path = ''
as $$ select private.create_return_request(p_order_id,p_item_index,p_request_type,p_quantity,p_reason,p_requested_size); $$;
revoke all on function public.create_return_request(bigint,integer,text,integer,text,text) from public, anon;
grant execute on function public.create_return_request(bigint,integer,text,integer,text,text) to authenticated, service_role;

create function public.finalize_bulk_quote(p_quote_id bigint, p_item_prices jsonb, p_valid_until timestamptz default null, p_admin_note text default null)
returns table(quote_id bigint, status text, quoted_subtotal numeric, quoted_gst numeric, quoted_delivery numeric, quoted_total numeric, valid_until timestamptz, quoted_at timestamptz)
language sql
security invoker
set search_path = ''
as $$ select * from private.finalize_bulk_quote(p_quote_id,p_item_prices,p_valid_until,p_admin_note); $$;
revoke all on function public.finalize_bulk_quote(bigint,jsonb,timestamptz,text) from public, anon;
grant execute on function public.finalize_bulk_quote(bigint,jsonb,timestamptz,text) to authenticated, service_role;

create function public.get_variant_availability(p_product_id bigint)
returns table(variant_id bigint, in_stock boolean)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_variant_availability(p_product_id); $$;
revoke all on function public.get_variant_availability(bigint) from public;
grant execute on function public.get_variant_availability(bigint) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;

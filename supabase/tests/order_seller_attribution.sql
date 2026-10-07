begin;

select public.order_item_seller_ids('[{"id":1,"seller_id":"11111111-1111-4111-8111-111111111111"},{"id":2,"seller_id":"11111111-1111-4111-8111-111111111111"}]'::jsonb)
  = array['11111111-1111-4111-8111-111111111111'::uuid] as deduplicates_seller;

select cardinality(public.order_item_seller_ids('[{"id":1,"sku":"FF-1"}]'::jsonb)) = 0 as does_not_infer_missing_seller;
select has_function_privilege('anon','public.get_seller_fast_dispatch_signal(uuid)','EXECUTE') = false as anon_blocked;
select has_function_privilege('authenticated','public.get_seller_fast_dispatch_signal(uuid)','EXECUTE') = false as authenticated_blocked;
select has_function_privilege('service_role','public.get_seller_fast_dispatch_signal(uuid)','EXECUTE') = true as service_role_allowed;

rollback;

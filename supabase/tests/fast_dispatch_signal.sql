-- Fast Dispatch privilege contract.
begin;

select plan(3);

select ok(
  not has_function_privilege('anon', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'anon cannot execute the seller fast-dispatch signal'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'authenticated clients cannot execute the seller fast-dispatch signal'
);
select ok(
  has_function_privilege('service_role', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'service_role can execute the seller fast-dispatch signal'
);

select * from finish();
rollback;

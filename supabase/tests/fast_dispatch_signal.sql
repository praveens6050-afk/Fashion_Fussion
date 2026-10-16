-- Fast Dispatch acceptance contract.
-- Production fixture tests should assert these boundaries against seeded orders.

begin;
select plan(3);

-- Function must remain unavailable to browser/user roles.
select ok(
  not has_function_privilege('anon', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'anon cannot execute the fast-dispatch signal'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'authenticated users cannot execute the fast-dispatch signal'
);
select ok(
  has_function_privilege('service_role', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'service_role can execute the fast-dispatch signal'
);

select * from finish();
rollback;

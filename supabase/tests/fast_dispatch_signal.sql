-- Fast Dispatch acceptance contract.
-- Production fixture tests should assert these boundaries against seeded orders.

begin;

-- Function must remain unavailable to browser/user roles.
select has_function_privilege('anon', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE') = false as anon_blocked;
select has_function_privilege('authenticated', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE') = false as authenticated_blocked;
select has_function_privilege('service_role', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE') = true as service_role_allowed;

-- Eligibility policy encoded by the function:
-- fewer than 10 completed dispatch samples => false
-- >=10 samples but <90% within 24h => false
-- >=10 samples and >=90% within 24h, but average >24h => false
-- >=10 samples, >=90% within 24h and average <=24h => true

rollback;

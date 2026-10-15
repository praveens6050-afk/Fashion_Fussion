-- Fast Dispatch fail-closed acceptance contract.
-- This verifies the migration can run without relying on nonexistent orders.seller_id
-- and that missing seller-level dispatch evidence can never produce an eligible badge.

begin;

do $$
declare
  v record;
  v_seller_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if has_function_privilege('anon', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute the Fast Dispatch RPC';
  end if;

  if has_function_privilege('authenticated', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE') then
    raise exception 'authenticated must not execute the Fast Dispatch RPC';
  end if;

  if not has_function_privilege('service_role', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE') then
    raise exception 'service_role must be able to execute the Fast Dispatch RPC';
  end if;

  select *
    into v
    from public.get_seller_fast_dispatch_signal(v_seller_id);

  if not found then
    raise exception 'Fail-closed RPC must return an explicit unavailable result';
  end if;

  if v.seller_id is distinct from v_seller_id then
    raise exception 'RPC returned the wrong seller identifier';
  end if;

  if v.sample_orders is distinct from 0::bigint
     or v.fast_dispatch_orders is distinct from 0::bigint then
    raise exception 'No verified seller-level samples may be counted';
  end if;

  if v.fast_dispatch_rate is not null or v.avg_dispatch_hours is not null then
    raise exception 'Metrics must be NULL when no verified samples exist';
  end if;

  if v.fast_dispatch is distinct from false then
    raise exception 'Fast Dispatch must remain false until verified seller-level data exists';
  end if;
end
$$;

rollback;

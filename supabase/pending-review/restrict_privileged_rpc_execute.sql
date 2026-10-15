-- NOT AN ACTIVE MIGRATION.
-- Kept outside supabase/migrations because applying this blanket revocation now would
-- break existing browser-based Admin workflows that call RPCs with the authenticated role.
-- Known direct callers include:
--   admin-panel/admin-creators.js: admin_list_seller_creator_offers, admin_review_seller_creator_offer
--   admin-panel/admin-seller-finance.js: admin_upsert_seller_settlement_breakdown
-- It also changes get_marketplace_product_signals() to SECURITY INVOKER; that needs a
-- caller/RLS/grant review before rollout. First move privileged calls behind server-side
-- service_role wrappers or build a carefully reviewed allowlist, then create a new migration.
--
-- Original proposed migration follows; do not move into supabase/migrations until reviewed.

-- Least-privilege RPC hardening.
-- Privileged admin/owner/support operations must never be callable merely because
-- a user has the generic `authenticated` database role. Server/admin code can
-- continue to invoke these with service_role. User-owned seller/customer RPCs
-- are intentionally left unchanged in this migration.

DO $hardening$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        p.proname LIKE 'admin\_%' ESCAPE '\'
        OR p.proname LIKE 'owner\_%' ESCAPE '\'
        OR p.proname LIKE 'support\_staff\_%' ESCAPE '\'
        OR p.proname = 'cleanup_seller_e2e_submissions'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END
$hardening$;

-- Public marketplace signals are intentionally readable by storefront clients,
-- but they do not need owner privileges. Run this read-only function as caller
-- so underlying grants/RLS remain effective and the function cannot bypass RLS.
DO $signals$
BEGIN
  IF to_regprocedure('public.get_marketplace_product_signals()') IS NOT NULL THEN
    ALTER FUNCTION public.get_marketplace_product_signals() SECURITY INVOKER;
    REVOKE EXECUTE ON FUNCTION public.get_marketplace_product_signals() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.get_marketplace_product_signals() TO anon, authenticated, service_role;
  END IF;
END
$signals$;

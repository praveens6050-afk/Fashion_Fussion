-- Harden the event-trigger helper so it cannot be called through PostgREST RPC.
-- The event trigger remains enabled; only client EXECUTE grants are removed.
-- Safe for the isolated CRM staging environment and reviewed before any production use.

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$$;

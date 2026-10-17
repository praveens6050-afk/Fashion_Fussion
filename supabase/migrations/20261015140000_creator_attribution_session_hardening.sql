-- Idempotent follow-up for the creator attribution session objects that are not
-- included in the canonical base migration 20261001085434_creator_attribution_sessions.sql.
-- This migration intentionally does not recreate functions or triggers.

CREATE INDEX IF NOT EXISTS creator_attribution_sessions_creator_link_idx
  ON public.creator_attribution_sessions(creator_link_id);

CREATE INDEX IF NOT EXISTS creator_attribution_sessions_product_idx
  ON public.creator_attribution_sessions(product_id);

DO $policy$
DECLARE
  v_roles name[];
  v_qual text;
  v_with_check text;
BEGIN
  SELECT roles, qual, with_check
    INTO v_roles, v_qual, v_with_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'creator_attribution_sessions'
    AND policyname = 'creator_attribution_no_direct_select';

  IF FOUND THEN
    IF v_roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR v_qual IS DISTINCT FROM 'false'
       OR v_with_check IS NOT NULL THEN
      RAISE EXCEPTION 'creator_attribution_no_direct_select exists with an unexpected definition; review manually';
    END IF;
  ELSE
    EXECUTE 'CREATE POLICY creator_attribution_no_direct_select ON public.creator_attribution_sessions FOR SELECT TO authenticated USING (false)';
  END IF;
END
$policy$;

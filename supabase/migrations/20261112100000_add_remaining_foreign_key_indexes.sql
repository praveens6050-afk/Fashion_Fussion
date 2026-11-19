-- Add indexes for foreign-key columns flagged by Supabase Performance Advisor.
-- These indexes are additive and do not change row visibility or write behavior.
-- Some live-only tables/columns are not represented in the checked-in migration
-- history, so create each index only when its target column exists.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_agent_approvals'
      AND column_name = 'requested_by'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_agent_approvals_requested_by_idx
      ON public.ai_agent_approvals (requested_by)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_agent_approvals'
      AND column_name = 'reviewed_by'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_agent_approvals_reviewed_by_idx
      ON public.ai_agent_approvals (reviewed_by)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_agent_runs'
      AND column_name = 'requested_by'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_agent_runs_requested_by_idx
      ON public.ai_agent_runs (requested_by)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_bank_profiles'
      AND column_name = 'admin_reviewed_by'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS business_bank_profiles_admin_reviewed_by_idx
      ON public.business_bank_profiles (admin_reviewed_by)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_email_reply_outbox'
      AND column_name = 'requested_by'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS crm_email_reply_outbox_requested_by_idx
      ON public.crm_email_reply_outbox (requested_by)';
  END IF;
END
$$;

COMMIT;

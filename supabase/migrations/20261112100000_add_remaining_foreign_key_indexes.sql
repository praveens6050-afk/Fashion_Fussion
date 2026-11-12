-- Add indexes for foreign-key columns flagged by Supabase Performance Advisor.
-- These indexes are additive and do not change row visibility or write behavior.
-- The server-only AI agent tables are managed outside the checked-in migration
-- history, so guard those indexes during clean local migration replay.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ai_agent_approvals') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_agent_approvals_requested_by_idx
      ON public.ai_agent_approvals (requested_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_agent_approvals_reviewed_by_idx
      ON public.ai_agent_approvals (reviewed_by)';
  END IF;

  IF to_regclass('public.ai_agent_runs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_agent_runs_requested_by_idx
      ON public.ai_agent_runs (requested_by)';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS business_bank_profiles_admin_reviewed_by_idx
  ON public.business_bank_profiles (admin_reviewed_by);

CREATE INDEX IF NOT EXISTS crm_email_reply_outbox_requested_by_idx
  ON public.crm_email_reply_outbox (requested_by);

COMMIT;

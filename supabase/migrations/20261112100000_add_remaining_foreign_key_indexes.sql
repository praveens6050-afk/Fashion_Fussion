-- Add indexes for foreign-key columns flagged by Supabase Performance Advisor.
-- These indexes are additive and do not change row visibility or write behavior.
BEGIN;

CREATE INDEX IF NOT EXISTS ai_agent_approvals_requested_by_idx
  ON public.ai_agent_approvals (requested_by);

CREATE INDEX IF NOT EXISTS ai_agent_approvals_reviewed_by_idx
  ON public.ai_agent_approvals (reviewed_by);

CREATE INDEX IF NOT EXISTS ai_agent_runs_requested_by_idx
  ON public.ai_agent_runs (requested_by);

CREATE INDEX IF NOT EXISTS business_bank_profiles_admin_reviewed_by_idx
  ON public.business_bank_profiles (admin_reviewed_by);

CREATE INDEX IF NOT EXISTS crm_email_reply_outbox_requested_by_idx
  ON public.crm_email_reply_outbox (requested_by);

COMMIT;

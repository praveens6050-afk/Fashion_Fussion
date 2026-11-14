create index if not exists ai_agent_approvals_requested_by_idx
  on public.ai_agent_approvals (requested_by);
create index if not exists ai_agent_approvals_reviewed_by_idx
  on public.ai_agent_approvals (reviewed_by);
create index if not exists ai_agent_runs_requested_by_idx
  on public.ai_agent_runs (requested_by);
create index if not exists business_bank_profiles_admin_reviewed_by_idx
  on public.business_bank_profiles (admin_reviewed_by);
create index if not exists crm_email_reply_outbox_requested_by_idx
  on public.crm_email_reply_outbox (requested_by);

-- These operational tables are provisioned by the connected production
-- environment and are not part of the disposable baseline schema in every
-- deployment. Add indexes only when the table and target columns exist.
do $migration$
begin
  if to_regclass('public.ai_agent_approvals') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='ai_agent_approvals' and column_name='requested_by') then
      create index if not exists ai_agent_approvals_requested_by_idx on public.ai_agent_approvals (requested_by);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='ai_agent_approvals' and column_name='reviewed_by') then
      create index if not exists ai_agent_approvals_reviewed_by_idx on public.ai_agent_approvals (reviewed_by);
    end if;
  end if;

  if to_regclass('public.ai_agent_runs') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='ai_agent_runs' and column_name='requested_by') then
    create index if not exists ai_agent_runs_requested_by_idx on public.ai_agent_runs (requested_by);
  end if;

  if to_regclass('public.business_bank_profiles') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='business_bank_profiles' and column_name='admin_reviewed_by') then
    create index if not exists business_bank_profiles_admin_reviewed_by_idx on public.business_bank_profiles (admin_reviewed_by);
  end if;

  if to_regclass('public.crm_email_reply_outbox') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_email_reply_outbox' and column_name='requested_by') then
    create index if not exists crm_email_reply_outbox_requested_by_idx on public.crm_email_reply_outbox (requested_by);
  end if;
end
$migration$;

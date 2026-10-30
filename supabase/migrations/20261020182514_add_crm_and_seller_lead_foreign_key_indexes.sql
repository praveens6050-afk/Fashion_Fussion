-- Covering indexes for all unindexed foreign keys flagged by Supabase Performance Advisor
-- (CRM schema + seller lead tables). Idempotent; safe to replay.
BEGIN;

-- crm_ab_tests
CREATE INDEX IF NOT EXISTS crm_ab_tests_created_by_idx ON public.crm_ab_tests (created_by);

-- crm_b2b_accounts
CREATE INDEX IF NOT EXISTS crm_b2b_accounts_created_by_idx ON public.crm_b2b_accounts (created_by);
CREATE INDEX IF NOT EXISTS crm_b2b_accounts_owner_user_id_idx ON public.crm_b2b_accounts (owner_user_id);
CREATE INDEX IF NOT EXISTS crm_b2b_accounts_parent_account_id_idx ON public.crm_b2b_accounts (parent_account_id);

-- crm_b2b_deal_stage_history
CREATE INDEX IF NOT EXISTS crm_b2b_deal_stage_history_changed_by_idx ON public.crm_b2b_deal_stage_history (changed_by);
CREATE INDEX IF NOT EXISTS crm_b2b_deal_stage_history_deal_id_idx ON public.crm_b2b_deal_stage_history (deal_id);

-- crm_b2b_deals
CREATE INDEX IF NOT EXISTS crm_b2b_deals_created_by_idx ON public.crm_b2b_deals (created_by);
CREATE INDEX IF NOT EXISTS crm_b2b_deals_owner_user_id_idx ON public.crm_b2b_deals (owner_user_id);

-- crm_b2b_quotes
CREATE INDEX IF NOT EXISTS crm_b2b_quotes_created_by_idx ON public.crm_b2b_quotes (created_by);
CREATE INDEX IF NOT EXISTS crm_b2b_quotes_deal_id_idx ON public.crm_b2b_quotes (deal_id);

-- crm_inbox_conversations
CREATE INDEX IF NOT EXISTS crm_inbox_conversations_assigned_to_idx ON public.crm_inbox_conversations (assigned_to);
CREATE INDEX IF NOT EXISTS crm_inbox_conversations_contact_user_id_idx ON public.crm_inbox_conversations (contact_user_id);

-- crm_inbox_send_attempts
CREATE INDEX IF NOT EXISTS crm_inbox_send_attempts_actor_user_id_idx ON public.crm_inbox_send_attempts (actor_user_id);

-- crm_marketing_campaigns
CREATE INDEX IF NOT EXISTS crm_marketing_campaigns_created_by_idx ON public.crm_marketing_campaigns (created_by);

-- crm_sales_activities
CREATE INDEX IF NOT EXISTS crm_sales_activities_account_id_idx ON public.crm_sales_activities (account_id);
CREATE INDEX IF NOT EXISTS crm_sales_activities_created_by_idx ON public.crm_sales_activities (created_by);

-- crm_sales_quotas
CREATE INDEX IF NOT EXISTS crm_sales_quotas_created_by_idx ON public.crm_sales_quotas (created_by);

-- crm_support_macros
CREATE INDEX IF NOT EXISTS crm_support_macros_created_by_idx ON public.crm_support_macros (created_by);

-- crm_team_members
CREATE INDEX IF NOT EXISTS crm_team_members_invited_by_idx ON public.crm_team_members (invited_by);

-- seller lead tables
CREATE INDEX IF NOT EXISTS seller_lead_activities_created_by_idx ON public.seller_lead_activities (created_by);
CREATE INDEX IF NOT EXISTS seller_lead_tasks_assigned_to_idx ON public.seller_lead_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS seller_lead_tasks_created_by_idx ON public.seller_lead_tasks (created_by);
CREATE INDEX IF NOT EXISTS seller_leads_assigned_to_idx ON public.seller_leads (assigned_to);

COMMIT;

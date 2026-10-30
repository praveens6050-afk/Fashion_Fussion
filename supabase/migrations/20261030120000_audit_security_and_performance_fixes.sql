-- Audit remediation: close direct RPC access to a trigger-only function,
-- index the two CRM auth-user foreign keys, and cache auth.uid() per statement
-- in the two CRM inbox-send policies flagged by the performance advisor.

REVOKE ALL ON FUNCTION public.crm_log_b2b_deal_stage() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS crm_zoho_mailbox_configs_connected_by_idx
  ON private.crm_zoho_mailbox_configs (connected_by);

CREATE INDEX IF NOT EXISTS crm_zoho_oauth_states_actor_user_id_idx
  ON public.crm_zoho_oauth_states (actor_user_id);

DROP POLICY IF EXISTS "Admin full access on inbox send attempts"
  ON public.crm_inbox_send_attempts;

CREATE POLICY "Admin full access on inbox send attempts"
  ON public.crm_inbox_send_attempts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.is_admin = true
    )
  );

DROP POLICY IF EXISTS "CRM staff view own sends"
  ON public.crm_inbox_send_attempts;

CREATE POLICY "CRM staff view own sends"
  ON public.crm_inbox_send_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_team_members
      WHERE crm_team_members.user_id = (SELECT auth.uid())
        AND crm_team_members.is_active = true
    )
  );

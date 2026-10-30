-- Consolidate overlapping CRM SELECT policies while preserving effective access.
-- Admins retain full row management. Sales staff retain quota reads. Active
-- CRM members retain self reads and staff send-attempt reads.

BEGIN;

DROP POLICY IF EXISTS "Admin full access on inbox send attempts"
  ON public.crm_inbox_send_attempts;
DROP POLICY IF EXISTS "CRM staff view own sends"
  ON public.crm_inbox_send_attempts;
CREATE POLICY "Admin and CRM staff may read inbox send attempts"
  ON public.crm_inbox_send_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
    OR EXISTS (
      SELECT 1 FROM public.crm_team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active IS TRUE
    )
  );
CREATE POLICY "Admins may insert inbox send attempts"
  ON public.crm_inbox_send_attempts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );
CREATE POLICY "Admins may update inbox send attempts"
  ON public.crm_inbox_send_attempts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );
CREATE POLICY "Admins may delete inbox send attempts"
  ON public.crm_inbox_send_attempts
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );

DROP POLICY IF EXISTS crm_sales_quotas_admin_manage
  ON public.crm_sales_quotas;
DROP POLICY IF EXISTS crm_sales_quotas_read
  ON public.crm_sales_quotas;
CREATE POLICY crm_sales_quotas_read
  ON public.crm_sales_quotas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
    OR public.crm_has_role(ARRAY['sales']::text[])
  );
CREATE POLICY crm_sales_quotas_admin_insert
  ON public.crm_sales_quotas
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );
CREATE POLICY crm_sales_quotas_admin_update
  ON public.crm_sales_quotas
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );
CREATE POLICY crm_sales_quotas_admin_delete
  ON public.crm_sales_quotas
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );

DROP POLICY IF EXISTS crm_team_members_admin_manage
  ON public.crm_team_members;
DROP POLICY IF EXISTS crm_team_members_self_read
  ON public.crm_team_members;
CREATE POLICY crm_team_members_read
  ON public.crm_team_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
    OR (user_id = (SELECT auth.uid()) AND is_active IS TRUE)
  );
CREATE POLICY crm_team_members_admin_insert
  ON public.crm_team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );
CREATE POLICY crm_team_members_admin_update
  ON public.crm_team_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );
CREATE POLICY crm_team_members_admin_delete
  ON public.crm_team_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
    )
  );

COMMIT;

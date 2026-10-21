-- CRM audit hardening: trigger-only function must not be callable through PostgREST RPC.
-- Trigger execution does not require client roles to have EXECUTE privileges.
-- Additive branch-only migration; do not apply to production without approval.
revoke all on function public.crm_log_b2b_deal_stage() from public, anon, authenticated, service_role;

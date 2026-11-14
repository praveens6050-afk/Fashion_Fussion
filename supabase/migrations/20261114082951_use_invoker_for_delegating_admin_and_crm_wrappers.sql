-- These wrappers delegate to SECURITY DEFINER helpers that perform their
-- own administrator or CRM membership authorization checks. The wrappers
-- themselves do not need elevated privileges.
alter function public.admin_upsert_seller_settlement(
  uuid,bigint,date,date,numeric,numeric,numeric,text,text,text,text
) security invoker;

alter function public.crm_inbox_can_access_conversation(text,text) security invoker;

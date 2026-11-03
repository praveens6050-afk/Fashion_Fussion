-- Prevent parallel outbound requests for the same CRM conversation.
-- Attempts remain in 'sending' while provider outcome needs reconciliation.
CREATE UNIQUE INDEX IF NOT EXISTS crm_inbox_send_attempts_one_active_per_conversation_uidx
  ON public.crm_inbox_send_attempts (conversation_id)
  WHERE state = 'sending';

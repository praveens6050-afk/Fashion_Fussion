-- Enable authenticated customer, seller, and admin support chats to receive live ticket updates.
-- The tables already have RLS policies scoped to the customer, active seller, customer-care team, and owner.
alter publication supabase_realtime
  add table public.support_tickets, public.support_ticket_messages;

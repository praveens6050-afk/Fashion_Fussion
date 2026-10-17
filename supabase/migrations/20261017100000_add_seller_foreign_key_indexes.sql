-- Add indexes for foreign-key columns identified by Supabase Performance Advisor.
-- These indexes improve parent-row delete/update checks and common seller-lead/offer lookups.
-- IF NOT EXISTS makes the migration safe to replay in environments where an equivalent index exists.
BEGIN;

CREATE INDEX IF NOT EXISTS seller_creator_offers_product_id_idx
  ON public.seller_creator_offers (product_id);

CREATE INDEX IF NOT EXISTS seller_leads_converted_seller_id_idx
  ON public.seller_leads (converted_seller_id);

COMMIT;

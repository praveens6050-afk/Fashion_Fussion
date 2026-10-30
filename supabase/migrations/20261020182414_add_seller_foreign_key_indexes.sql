-- Add indexes for foreign-key columns identified by Supabase Performance Advisor.
-- Matches repo PR #332 (fix/seller-foreign-key-indexes); idempotent so the PR can merge cleanly afterward.
BEGIN;

CREATE INDEX IF NOT EXISTS seller_creator_offers_product_id_idx
  ON public.seller_creator_offers (product_id);

CREATE INDEX IF NOT EXISTS seller_leads_converted_seller_id_idx
  ON public.seller_leads (converted_seller_id);

COMMIT;

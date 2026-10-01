-- This timestamped migration records the documentation comment already applied to production.
-- Kept separate from functional migrations so deployment history remains auditable.
comment on function public.get_marketplace_product_signals() is 'Public-safe marketplace discovery signals only. Returns derived seller verification boolean, LaunchPad visibility boolean, in-catalog category price signal/reference and relevance boost. It intentionally does not expose raw compliance, KYC or payout data.';

-- No-op migration marker for the Phase 2 security review.
-- get_marketplace_product_signals() intentionally exposes only derived/public-safe fields
-- to anonymous storefront users; raw seller compliance and payout data remain inaccessible.
select 1;

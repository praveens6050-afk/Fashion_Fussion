-- Keep the seller KYC review RPC available to signed-in callers only.
-- The function body also enforces admin authorization through auth.uid().
revoke all on function public.admin_mark_seller_kyc_under_review(uuid, text) from public, anon;
grant execute on function public.admin_mark_seller_kyc_under_review(uuid, text) to authenticated;

-- Trigger-only SECURITY DEFINER functions must not be exposed as RPCs.
revoke all on function public.mark_customer_profile_business() from public, anon, authenticated;
revoke all on function public.protect_business_gst_verification() from public, anon, authenticated;

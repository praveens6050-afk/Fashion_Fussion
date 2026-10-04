# Deploy notes

Migrations are ordered so `calculate_upi_merchant_mdr` is created before `resolve_payment_processing_fee`. Apply through the normal Supabase migration pipeline; do not paste ad-hoc production SQL unless recovery procedures require it. Verify database and checkout behavior after deployment.

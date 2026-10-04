# Customer checkout guard

Do not add `calculate_upi_merchant_mdr` or `resolve_payment_processing_fee` to cart, checkout, order-total or customer invoice calculations. MDR belongs exclusively to post-payment merchant settlement accounting.

The functions are intentionally unavailable to `anon` and `authenticated` database roles.

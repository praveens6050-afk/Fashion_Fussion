# UPI MDR test coverage

`upi_merchant_mdr.sql` covers threshold, effective date, rate, cap, non-UPI payments, provider-fee double-charge prevention and explicit exemptions.

`payment_processing_fee.sql` covers settlement resolution and verifies actual provider processing fees take precedence over the MDR estimate.

These tests are intentionally database-level because payment processing deductions belong to authoritative settlement accounting, not browser/customer checkout calculations.

# UPI Merchant MDR Accounting

Effective 15 October 2026 (IST), Fashion Fussion accounting can estimate merchant-side UPI MDR using `public.calculate_upi_merchant_mdr`.

Policy:
- 0% at or below ₹2,000.
- 0.4% for eligible UPI merchant payments above ₹2,000.
- Maximum ₹300 per eligible transaction.
- Never add MDR to the customer checkout total or present it as a customer surcharge.
- Keep MDR/payment processing separate from marketplace commission, commission GST, shipping, returns/RTO, refunds and other deductions.
- LaunchPad 0% marketplace commission does not waive actual payment-processing costs.
- If the payment provider already reports a positive processing fee, the estimator returns zero to prevent double charging.
- Provider metadata can mark a payment ineligible/exempt; in that case MDR is zero.

Settlement integration should write the resulting amount into the existing payment-processing-fee component of the authoritative seller settlement breakdown. Provider-reported actual fees take precedence over this estimate.

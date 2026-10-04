# Operations

For settlement reconciliation, compare the stored payment-processing deduction against the payment provider's statement. When an actual provider fee becomes available after an estimate, reconciliation should use the actual fee as source of truth and avoid adding the estimate again.

Refund/return handling remains in the existing refund/return settlement components; this change does not invent a separate customer refund deduction or customer MDR charge.

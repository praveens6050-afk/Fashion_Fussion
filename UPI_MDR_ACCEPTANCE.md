# Acceptance criteria

The feature is acceptable when:

- ₹2,000 eligible UPI => ₹0 MDR.
- ₹3,000 eligible UPI => ₹12 MDR.
- ₹5,000 eligible UPI => ₹20 MDR.
- ₹75,000 or higher eligible UPI => no more than ₹300 MDR.
- pre-15-Oct-2026, non-UPI and explicitly exempt transactions => ₹0 estimated MDR.
- positive actual provider processing fee => actual fee is used, with no additional MDR estimate.
- customer checkout payable is unchanged.
- seller settlement shows payment-processing deduction separately from marketplace commission.

# UPI MDR rollout

1. Review and merge the feature branch after CI.
2. Apply the new Supabase migrations to production.
3. Normalize payment-provider metadata to: payment method, paid timestamp, actual provider processing fee (when supplied), and MDR eligibility/exemption.
4. At authoritative settlement creation/reconciliation, use `resolve_payment_processing_fee` and persist the result in the existing payment-processing deduction field.
5. Confirm customer checkout totals are identical before/after rollout.
6. Confirm seller/admin settlement breakdowns show payment processing separately from marketplace commission.
7. Reconcile first live eligible UPI transactions against provider statements before relying on estimates operationally.

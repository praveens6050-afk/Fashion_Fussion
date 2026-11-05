# UPI MDR rollout

Before production activation:
1. Apply the Supabase migrations through the normal migration pipeline.
2. Wire trusted provider payment method, paid timestamp, actual processing fee and MDR eligibility into settlement creation/reconciliation.
3. Persist the resolved amount in the existing payment-processing deduction, not marketplace commission.
4. Verify customer payable totals are unchanged.
5. Reconcile initial eligible UPI transactions against provider statements.

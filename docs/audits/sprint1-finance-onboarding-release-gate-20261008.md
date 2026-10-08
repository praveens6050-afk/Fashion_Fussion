# Sprint 1 — Financial integrity and onboarding release gate (8 October 2026)

Status: **Audit in progress; no production changes authorized by this document.**

## Verified repository observations
- Production Cloudflare customer, seller and admin branches have diverged from main. Never bulk-merge main into production without reviewing branch-specific changes.
- `seller-panel/seller-net-payout-calculator.js` is a client-side **estimate**, with configurable commission, payment, shipping and expected return assumptions. It is not an authoritative settlement ledger.
- `seller-panel/plans-fees-compliance-help.js` includes explicitly named demo plans. Never expose demo percentages as contractual production fees.
- Some seller onboarding, promotions and shipping UI modules use browser localStorage, while finance and creator modules also use Supabase. Browser state must not be treated as verified seller identity, payment, order or payout state.
- `supabase/migrations/20260924162617_seller_settlement_deduction_breakdown.sql` is a migration-history placeholder, **not** proof of the current live database schema.

## Release blockers to verify
1. Confirm applied migration versions and schema in the **actual** Supabase project before relying on payout deductions, creator offers or KYC.
2. Trace the authoritative order-item settlement RPC and its commission, payment fee, shipping, taxes, returns and creator deductions. Check rounding, refunds, negative balances and idempotency.
3. Compare the seller earnings UI with admin settlement data and server-computed checkout/order totals using identical test fixtures.
4. Verify seller onboarding persists across browsers and devices and cannot bypass admin approval through localStorage.
5. Validate seller/customer/admin role boundaries, RLS and payout approvals.
6. Run relevant automated tests plus authenticated seller and admin browser E2E tests against a non-production environment.
7. Confirm Cloudflare branch-to-domain mappings and deploy via reviewed PR only after CI and smoke tests pass.

## Implementation order
- **P0-A:** Reconcile actual seller fee configuration and settlement ledger; label all estimates as estimates.
- **P0-B:** Consolidate seller onboarding status into server-authoritative state.
- **P0-C:** Add cross-panel financial and approval E2E regression tests.
- **P1:** Creator commission lifecycle and catalog discovery improvements.
- **P2:** Shoppable video and delivery SLA improvements.

## Safety
Do not change live fee rates, process real payouts, modify production migrations, or deploy customer-facing financial changes before confirming authoritative business rules and successful tests.

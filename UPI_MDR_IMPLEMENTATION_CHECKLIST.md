# UPI MDR rollout checklist

- [x] 0.4% eligible UPI MDR calculation above ₹2,000.
- [x] ₹300 transaction cap.
- [x] 15 Oct 2026 IST effective-date guard.
- [x] Exemption/eligibility switch.
- [x] Provider actual processing fee takes precedence (no double charge).
- [x] Service-role-only calculation/resolution helpers.
- [x] SQL boundary tests.
- [x] Explicit policy that MDR is merchant-side and must never change customer checkout totals.
- [ ] Payment provider webhook/finalization should pass normalized payment method, paid timestamp, provider fee and eligibility metadata into the settlement writer when those fields are available.
- [ ] Production Supabase migration must be applied and verified before treating the rule as live.
- [ ] Verify seller/admin settlement UI labels the amount as payment processing/MDR, not platform commission.

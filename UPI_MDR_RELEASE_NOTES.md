# Release notes — UPI merchant MDR

Prepared support for the 15 Oct 2026 merchant UPI MDR policy in Fashion Fussion settlement accounting.

- 0.4% for eligible UPI merchant transactions above ₹2,000.
- ₹300 maximum per eligible transaction.
- Provider actual processing fee overrides the estimate.
- Explicit eligibility/exemption input.
- Service-role-only database helpers.
- No customer-facing surcharge or checkout-total change.
- Database boundary tests included.

Production activation still requires applying the Supabase migrations and wiring payment-provider metadata into the authoritative settlement writer.

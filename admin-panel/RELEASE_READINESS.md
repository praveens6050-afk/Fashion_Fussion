# Production release readiness

This release branch is a controlled validation candidate for Fashion Fussion.

## Release invariants

- The production storefront remains served by the currently configured Cloudflare Pages production branch until a validated promotion is approved.
- Customer, seller, and CRM Pages builds must succeed independently before any production branch change.
- Supabase migrations must replay on a disposable local database and must match the live migration history before any database rollout.
- Payment capture, refunds, seller payouts, shipping labels, email delivery, and WhatsApp messaging require end-to-end tests with provider sandbox credentials before live activation.
- Never expose Supabase service-role/secret keys in browser bundles or public environment variables.
- RLS and function authorization must be validated against customer, seller, staff, and anonymous identities; do not apply blanket policies or blanket SECURITY DEFINER revocations.
- Production changes require a rollback path and post-deployment smoke checks.

## Current known release gates

- Supabase leaked-password protection is still reported disabled and must be enabled in Auth settings.
- The production branch and current main branch have substantial independent history; do not point production directly at main without an integration review and successful preview builds.
- Payment, shipping, seller finance, and outbound communication provider credentials and live approval gates must be verified in their respective dashboards. Secret values are intentionally not copied into this repository.
- Security advisor findings for server-only RLS tables and authenticated SECURITY DEFINER RPCs require per-object review, not bulk changes.

## Promotion checklist

- [ ] Customer Pages preview build and customer browser journey pass.
- [ ] Seller Pages preview build and seller onboarding/product/inventory journey pass.
- [ ] CRM Pages preview build and staff authorization/inbox journey pass.
- [ ] Supabase migration replay and security/performance advisor review complete.
- [ ] Razorpay test payment, webhook verification, refund/reconciliation checks pass.
- [ ] Shipping provider sandbox create/track/cancel checks pass.
- [ ] Seller KYC and payout flow verified with manual review and settlement reconciliation.
- [ ] Email and WhatsApp delivery verified in test mode; opt-in and suppression rules confirmed.
- [ ] DNS, HTTPS, TLS, security headers, uptime monitoring, backups, and rollback procedure verified.
- [ ] Production deployment promoted deliberately, then all public and authenticated journeys smoke-tested.

Do not mark this checklist complete based on source checks or CI alone.

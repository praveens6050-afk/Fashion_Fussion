# Admin market launch readiness

Validation branch based on the configured Admin production branch. This branch is for preview verification only.

- Cloudflare Pages build must succeed with the Admin production build and login-hardening steps.
- Admin routes remain noindex and no-store, and the existing strict security headers must remain intact.
- Staff authorization and role boundaries must be tested with non-admin, staff, and owner identities.
- No service-role or secret key may be present in browser assets.
- Payment, shipping, refund, and payout actions must remain gated by explicit admin authorization and provider sandbox checks.
- Do not promote this branch until the preview, authorization, browser, and production smoke checks pass.

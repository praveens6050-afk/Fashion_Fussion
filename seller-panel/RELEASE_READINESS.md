# Seller market launch readiness

This validation branch is based on the currently configured Seller production branch. It is for isolated preview build verification only.

## Required gates
- Cloudflare Pages preview build succeeds using the panel's current build configuration.
- Browser smoke tests cover login/session, role boundaries, primary panel workflows, error handling, and responsive layout.
- Supabase access is tested with anonymous, customer, seller, staff, and service identities where applicable.
- No service-role or secret key is shipped to browser code.
- Payment, refunds, shipping, seller finance, email, and WhatsApp integrations remain in sandbox or explicitly approved live modes until provider-level tests pass.
- Database migrations are replayed locally and verified against the live migration history before production changes.
- A tested rollback path and post-deploy smoke checks are required.

## Known shared launch gates
- Supabase leaked-password protection was reported disabled in the latest security advisor scan.
- Public SECURITY DEFINER RPCs and server-only RLS tables require object-by-object authorization review; do not apply blanket grants, policies, or revocations.
- Production deployment branches are intentionally independent from main and must not be switched without an integration plan.
- This checklist is not complete until panel-specific preview, browser, provider sandbox, and production smoke tests pass.

## Promotion
Do not promote this validation branch directly to production. Merge only reviewed application fixes into the corresponding production branch after all checks pass.

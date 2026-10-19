# Fashion Fussion — all-role WhatsApp implementation and test gates

Status: implementation branch only. This document is not a launch approval. Do not enable sending or run production migrations from this checklist.

## Goal
Finish the integration before end-to-end testing for customer, seller, admin and CRM operations. Existing customer order-confirmation code is not sufficient to certify the other roles.

## Verified gaps from the connected production schema and Pages configuration
- The customer order-confirmation outbox and atomic claim/finish RPCs exist, but the outbox currently has no records. Actual delivery is unproven.
- The live `orders` table has no `seller_id` column. A read-only audit of 14 existing order lines found zero matches from item `id` to `seller_product_submissions.approved_product_id`, so those legacy lines cannot safely route to sellers. The canonical seller product-approval workflow does store `approved_product_id` and `seller_id`; new seller-order routing should use that relationship and must skip unmapped/ambiguous legacy products.
- The read-only role readiness endpoint previously hard-coded customer atomic schema readiness to false. This branch adds a restricted, read-only schema probe and wires readiness to its result; it still must be replayed/tested in an isolated database before production use.
- Seller onboarding automation and a dedicated admin-alert pipeline are not configured in production.
- The Seller Pages project has WhatsApp credentials configured, but the order-send gates and a dedicated private dispatch token are not configured in the production environment-variable inventory.
- The Admin and CRM Pages projects do not currently expose the seller's WhatsApp credential names. They should consume privacy-safe, authenticated server-side delivery status—not copy Meta credentials into browser projects.
- A standalone Cloudflare Worker is not currently listed. Do not add a scheduler until dispatch has passed controlled tests and a separate operational approval is recorded.

## Work committed to the implementation branch
- Added `supabase/migrations/20261019150000_whatsapp_notification_schema_readiness.sql`: a service-role-only, stable read-only RPC that checks required customer notification columns and the claim/finish function signatures. It does not stage rows, alter consent, authorize sends, or return recipient data.
- Updated `seller-panel/functions/api/outreach/whatsapp-roles-readiness.js` to call that probe and report schema readiness accurately instead of a hard-coded false.
- Updated `seller-panel/tests/whatsapp-roles-readiness.test.mjs` with positive, missing-schema, missing-RPC and fail-closed cases; readiness now reports customer, seller product mapping/recipient, admin identity and admin-alert storage gaps independently.
- Added `supabase/migrations/20261019160000_whatsapp_admin_alert_foundation.sql`: a private verified-admin recipient registry and deduplicated outbox with RLS, service-role-only grants, event allowlists, safe reference codes and one-attempt constraints. Its service-only staging RPC only targets currently enabled, verified admin accounts and does not send messages.
- Added `supabase/migrations/20261019170000_whatsapp_seller_order_alert_foundation.sql`: seller order alerts are staged only when a fresh eligible order's product/variant maps to an approved seller product, seller is active and phone-verified, and transactional consent exists. Unmapped legacy orders are skipped. The private outbox is deduplicated and RLS-protected; there is no sender or retry loop.
- Added isolated SQL assertions and CI replay-twice checks for both role-specific outboxes, grants, and fail-closed staging.
- Added isolated SQL assertions for admin recipient/outbox privacy and idempotency, and wired the new migration to run twice in the WhatsApp SQL CI job.
- The existing customer dispatcher remains gated on explicit flags, recent eligible orders, consent, atomic claim, Meta GET-only template/phone verification, and no automatic retry after uncertain outcomes.

## Required implementation

### 1. Customer
- Keep OTP identity verification separate from transactional consent.
- Persist affirmative, unchecked-by-default consent only after verified signup; enforce STOP/revocation.
- Keep order eligibility, order-specific consent, payment/COD checks, freshness cutoff, atomic at-most-once claim, rate limits, and no automatic retry after an uncertain Meta outcome.
- Readiness verifies required database columns and service-only claim/finish RPCs; migration and automated tests must pass before the probe can be trusted.

### 2. Seller
- Keep seller marketing opt-in separate from transactional order alerts.
- Use the canonical `seller_product_submissions.approved_product_id` → `seller_id` relationship for seller-approved products, and validate the order item's product/variant ID against the actual schema. The 14 sampled existing order lines were not mapped to approved seller submissions; skip those legacy items rather than guessing or backfilling ownership without evidence.
- Implement order alerts only after the verified canonical order-item-to-seller relationship is available.
- Require a registered, verified seller recipient and approved utility template. Never treat a seller's public listing phone number as WhatsApp consent.
- Use a dedicated private outbox/claim/finish flow, event-level idempotency, rate limits, signed delivery receipts and no blind retry after uncertain provider outcome.

### 3. Admin
- Create a server-managed allowlist of verified admin recipients; never infer recipients from all profiles or expose the list to browser roles.
- Require an approved operational utility template and a separate global launch gate.
- Use a dedicated operational-alert outbox with deduplication, rate limiting, privacy-minimal message content and delivery/failure tracking.
- Never send OTPs, tokens, raw provider errors, customer addresses or payment credentials in operational alerts.

### 4. CRM
- Keep CRM delivery monitoring read-only and authenticated.
- Show role, event, state, timestamp, provider status and safe error category only; exclude phone/email, OTP data, message payloads and credentials.
- CRM campaign/journey planning must remain manual and must not send marketing messages.

## Environment gates
- Do not print or copy secret values into GitHub, SQL, browser code or chat.
- Keep sending disabled until the implementation, staging migration replay, schema/privilege checks, approved Meta templates and GET-only sender/template verification all pass.
- Production launch requires an explicit separate go/no-go. No scheduler or cron is enabled by this document.

## Test phase — only after implementation is complete
Use dedicated disposable test identities, not existing customer/seller accounts:
1. Customer signup, WhatsApp OTP send/verify, explicit consent on/off, STOP/revocation, login and consent persistence.
2. Seller signup with required business details, OTP send/verify, seller-role resolution, onboarding opt-in and no marketing send without consent.
3. Admin allowlist and authorized role; unauthorized user must be rejected.
4. Create a fresh test COD order and a separately payment-verified prepaid order, each with explicit transactional consent; verify exactly one eligible outbox event and Meta receipt progression.
5. Verify seller order alert routes only to the actual seller associated with the order's items.
6. Verify admin operational alert only reaches allowlisted, verified recipients.
7. Verify duplicate webhook/order events are idempotent; STOP suppresses sends; provider timeout/rejection is not automatically retried.
8. Verify CRM only displays privacy-safe delivery diagnostics.
9. Confirm no payment capture, refunds, historical-order resends or messages to non-consenting users occur during tests.

## Current boundary
This branch does not change production database data, production Cloudflare variables, production sending gates, DNS, or scheduler configuration. Test accounts and live sends are intentionally deferred until the implementation and staging safety checks are complete.

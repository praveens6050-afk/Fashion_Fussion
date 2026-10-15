# Fashion Fussion — WhatsApp final handoff / release gates
**Prepared 15 October 2026.** This is a code and test handoff, **NOT** a claim that automatic WhatsApp is live.

## Verified code/test coverage
| Workflow | In Draft PR | What remains before launch |
| --- | --- | --- |
| Shared signed inbound WhatsApp webhook + JOIN/STOP consent | Yes (existing) | Real signed callback subscription and delivery re-test after approved deploy |
| Customer COD / payment-verified prepaid order confirmation | Yes: atomic SQL, opt-in, rate-capped private dispatcher and 3-body-parameter approved utility template | Healthy Supabase staging migration; controlled production SQL rollout; real Meta GET-only WABA/phone matching; explicit sending approval; first NEW consented pilot order |
| Customer shipment / out-for-delivery / delivered | Consent/verified shipment event staging exists in SQL; dry-run preview exists | Separate reviewed atomic claim/dispatcher for each event with delivery-state idempotency; do NOT use order-confirmed sender for other event types |
| Seller marketing onboarding | Existing service-only consent-gated template outreach API; signed opt-in command JOIN FASHION SELLER | **0 currently opted-in marketing contacts**. Exact approved marketing template, consent provenance, dedicated non-duplicate campaign queue and explicit pilot approval; do not send cold bulk WhatsApp |
| Seller new-order alerts | No dedicated WhatsApp dispatcher | Registered seller recipient / authorized preference, approved utility template, verified order ownership, outbox/dedup and signed receipts |
| Admin operational alerts | No dedicated admin WhatsApp workflow or verified admin recipient registry | Approved separate utility template(s), strictly authorized contacts, incident alert outbox, rate limits and response acknowledgment |
| Meta utility order_status_update template | User's screenshots show existing Active / Quality Pending Utility English and matching 3-variable text + static header | Actual GET-only Graph `APPROVED` status and WABA Phone Number ID membership; private `/api/outreach/whatsapp-meta-readiness` not live until deploy |
| Customer / Seller / Admin audit | New protected GET-only `/api/outreach/whatsapp-roles-readiness` | Post-deployment server configuration check; never interpret role inventory as permission to send |
| Readiness dashboard | New `/whatsapp-readiness.html` operator page | Seller Pages deploy after explicit authorization, preflight secrets entered only in browser on official seller domain |

## Current production facts (read-only at preparation)
- WhatsApp order outbox: **0** messages; attempted: **0**.
- Active marketing consent count: **0**; inbound unclassified/needs-review: **29**.
- Atomic schema column `attempt_started_at`: absent; `claim_whatsapp_order_confirmation`: absent.
- Only listed Supabase branch is reported `MIGRATIONS_FAILED`. Do not apply migration to it or to production as a substitute for valid staging.
- User added a Cloudflare WABA ID. Its runtime value is **not readable** from current connectors and is **not Meta API verified**. Do not request or expose Meta secret tokens in chat.
- Existing Zoho Mail and WhatsApp OTP/inbound code must remain unchanged/operational. No historical order or order #25 resends.

## Code tests
- `.github/workflows/whatsapp-order-confirmation-safety.yml` runs 7 Node.js fail-closed suites and an isolated PostgreSQL 16 service applying the actual proposed migration twice then synthetic SQL assertions.
- Scope: signed callbacks, customer opt-in/checkout, false/prepaid/COD orders, aborted and duplicate events, provider receipts, first-attempt limits, WABA/template verification before claim, seller marketing opt-in presence, Admin rollout blockers, privacy-safe operator dashboard.
- **Mock and isolated DB tests never demonstrate real Meta message delivery, Cloudflare deployment health or approved WABA credentials.**

## Exact rollout order after explicit production-deployment approval
1. Resolve valid non-production Supabase branch/staging project. A new Supabase branch may have a charge; check costs and get owner's approval before creating it.
2. Apply proposed `seller-panel/sql/whatsapp_order_confirmation_atomic_dispatch.sql` on staging only, verify `whatsapp_prelaunch_readonly_audit.sql` plus regression tests, no Meta sends.
3. Approve/merge reviewed GitHub PR, deploy code only to Seller Pages with **sending flags not enabled**. Do not disable other environment flags, email senders or WhatsApp webhook.
4. Confirm Seller Pages server-side `WHATSAPP_BUSINESS_ACCOUNT_ID` and existing Meta phone ID/Graph token, and run the new private GET-only readiness dashboard. Confirm `order_status_update` is actually `APPROVED`, English Utility, exact body/static header, assigned phone ID in WABA. Confirm opt-in and OAuth permission to read templates.
5. On production, during an authorized maintenance window apply the reviewed migration **only after staging matches**. Verify service-only claim/finish permissions, trigger health, no historical replay, and outbox state. Do not enable schedule/dispatch.
6. Create a **new legitimate order** from a controlled test buyer who explicitly checks optional order WhatsApp consent. Inspect only dry-run eligibility and one-order outbox staging; no fake customer consent or backdated purchases.
7. Seek **separate explicit authorization** for one-time pilot sending before enabling new launch flags; first inspect candidate queue for only approved test order, rate caps and suppression of duplicates. Confirm actual Meta `wamid` response and signed delivered/read callback; a provider-accepted message does not guarantee delivery.
8. Only after successful pilot should an authenticated private WhatsApp-specific scheduler be designed/approved. Customer shipping events, seller onboarding and admin alerts each require their separate approved consent/template/ownership workflows before any auto-send.
9. Check error fallback, zero retries on unknown provider outcome, audit privacy, and observe no degradation to Zoho Mail, checkout, payment or OTP flows.

## No-go triggers
- Missing live WABA/Phone Number ID match, unapproved or changed template, sender token lacks Meta access.
- Any anonymous execute grant to checkout/internal RPC, absent valid marketing consent, revoked order consent or wrong order phone.
- Unverified COD/prepaid event, cancelled or historical order, duplicate queue/provider submission, ambiguous Meta network result.
- Failed staging migrations, invalid cron/secret configuration, incomplete receipt-webhook validation.
- Missing admin utility template or verified admin recipient; *never substitute the customer-order template* for internal alerts.

**Final state:** Draft PR only; user requested no production deploy until separate notification and decision. This document authorizes nothing to be sent.

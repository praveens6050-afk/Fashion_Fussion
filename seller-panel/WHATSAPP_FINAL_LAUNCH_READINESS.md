# Fashion Fussion — WhatsApp final handoff / release gates
**Prepared 15 October 2026.** This is a code and test handoff, **NOT** a claim that automatic WhatsApp is live.

## Verified code/test coverage
| Workflow | In Draft PR | What remains before launch |
| --- | --- | --- |
| Shared signed inbound WhatsApp webhook + JOIN/STOP consent | Yes (existing) | Real signed callback subscription and delivery re-test after approved deploy |
| Customer COD / payment-verified prepaid order confirmation | Yes: atomic SQL, opt-in, rate-capped private dispatcher and 3-body-parameter approved utility template | Healthy Supabase staging migration; controlled production SQL rollout; real Meta GET-only WABA/phone matching; explicit sending approval; first NEW consented pilot order |
| Customer shipment / out-for-delivery / delivered | **New private, independently gated atomic shipping dispatcher and service-only claim RPC added to Draft PR**; shared quota and per-event uniqueness; synthetic SQL/JS tests included | Valid staging database; production migration after approval; Meta live GET verification, legitimate post-consent shipment and separately approved pilot before sending |
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


## Shipping milestone implementation (this Draft PR, no live send)
- `seller-panel/functions/api/outreach/whatsapp-shipping-dispatch.js` accepts only `{"dryRun":true}` with operator token or `{"dispatch":true}` with a **new, separate 40+ character** `WHATSAPP_SHIPPING_INTERNAL_TOKEN`. The protected route does not accept arbitrary order IDs.
- Global shipping flags, **all false/absent by default**, are `WHATSAPP_SHIPPING_SENDING_ENABLED=true`, `WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED=true`, `WHATSAPP_SHIPPING_GLOBAL_LAUNCH_ACK=verified_shipping_opt_in_v1`, and `WHATSAPP_SHIPPING_NOT_BEFORE=<UTC ISO timestamp before an authorized NEW milestone>`. **Do not configure/enable for production until separate pilot approval**.
- Service-only `public.claim_whatsapp_shipping_event(bigint,text,timestamptz)` handles *only* `shipped`, `out_for_delivery`, `delivered`, requires exactly current verified fulfillment state, recent fulfillment transition, matching account owner/phone, per-order and transactional consent predating shipment, forward-shipment AWB, payment-verified prepaid or confirmed COD; delivered COD must already be collected.
- Uses the same existing unique order/event outbox, shared `pg_advisory_xact_lock(733012,417021)`, shared 5-first-attempt/hour and 20/24h caps with order confirmation, and one provider attempt per event. Provider timeout or ambiguous outcome is **never automatically retried**. Standard Meta `order_status_update` approved English Utility template receives the actual 3 verified parameters, with status label taken only from allowlisted event names.
- Live Meta-approved utility template and matching WABA/Phone Number ID must pass the GET-only preflight **before any database claim**. Extra signed receipt callbacks continue through existing webhook.
- Tests: `seller-panel/tests/whatsapp-shipping-dispatch.test.mjs` (mocked Meta and DB, no live sends) plus `seller-panel/tests/sql/whatsapp-shipping-assertions.sql` (ephemeral PostgreSQL only, transaction rolled back). Both wired into WhatsApp Safety CI.
- The operator readiness page and role report may still label customer as launch-blocked until Supabase deployment and live preflight; **this is correct**. No new automatic shipping schedule was added.

## Seller onboarding marketing template verification (read only; no broadcasts)
- `seller-panel/functions/api/outreach/whatsapp-seller-template-readiness.js` adds a **private GET-only** Meta Graph preflight requiring numeric WABA/Phone Number IDs, read-capable token, and new explicitly configured `WHATSAPP_SELLER_ONBOARDING_TEMPLATE` in the existing `WHATSAPP_ALLOWED_TEMPLATES` list. **The exact template name must be confirmed**, not inferred from screenshot truncation.
- It checks Meta `APPROVED`/Marketing/`en`, matching WABA phone ID, complete API response and inspects body parameter count, but **always returns `readyForSending:false`** until separate recipient-level proof of consent, marketing copy/variable review, campaign queue, and pilot sign-off. A public seller's phone number is not consent.
- Operator `/whatsapp-readiness.html` now shows Customer order template, seller marketing template, database health, and role-specific blockers in a single no-send dashboard. Input token is cleared and never stored in browser storage/URL. This page is **not yet deployed**.
- The synthetic Meta readiness CI includes missing template name, wrong/paused category, phone mismatch, API 403, no-POST and no secret exposure.
- **No automatic seller acquisition broadcast has been built or authorized**, because production currently has zero eligible marketing opt-ins. Existing manually consent-gated outreach API remains available separately.

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
8. Only after successful pilot should an authenticated private WhatsApp-specific scheduler be designed/approved. Customer shipping has a separately gated, tested code path but still requires its own explicit pilot approval; seller onboarding and admin alerts require independently verified consent/template/ownership workflows before any auto-send.
9. Check error fallback, zero retries on unknown provider outcome, audit privacy, and observe no degradation to Zoho Mail, checkout, payment or OTP flows.

## No-go triggers
- Missing live WABA/Phone Number ID match, unapproved or changed template, sender token lacks Meta access.
- Any anonymous execute grant to checkout/internal RPC, absent valid marketing consent, revoked order consent or wrong order phone.
- Unverified COD/prepaid event, cancelled or historical order, duplicate queue/provider submission, ambiguous Meta network result.
- Failed staging migrations, invalid cron/secret configuration, incomplete receipt-webhook validation.
- Missing admin utility template or verified admin recipient; *never substitute the customer-order template* for internal alerts.

**Final state:** Draft PR only; user requested no production deploy until separate notification and decision. This document authorizes nothing to be sent.

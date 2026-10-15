# Fashion Fussion — WhatsApp order confirmation: controlled launch checklist

## Status
This PR is a **code-only preparation** for Customer COD and prepaid order-confirmation WhatsApp messages. Existing live Zoho emails and all Cloudflare flags remain untouched. No new database migration is applied until reviewed, and NO WhatsApp message is sent while testing.

Known current runtime: signed WhatsApp webhook persists inbound messages and Meta delivery receipts; `whatsapp_order_notification_outbox` exists but was empty; the first live COD order (database order 25) had **no per-order WhatsApp opt-in**. Do not contact that buyer on WhatsApp, invent a consent record or backfill historic orders.

## Capabilities
- `seller-panel/sql/whatsapp_order_confirmation_atomic_dispatch.sql` extends the existing consent-based order-event staging to support genuine **COD** confirmation and verified **prepaid** orders, while retaining shipping checks. It does NOT send messages.
- One durable outbox record per `(order_id,event_type)`, with DB transaction-level `pg_advisory_xact_lock`, eligibility/consent/phone recheck, max **5 first attempts/hour and 20/day**, and at-most-once claim.
- `POST /api/outreach/whatsapp-order-confirmation-dispatch` supports operator `{"dryRun":true}` read-only previews. `{"dispatch":true}` requires a distinct private 40+ character **WHATSAPP_ORDER_INTERNAL_TOKEN**, and ALL production gates enabled. No browser-side token. Max two eligible messages/tick. No arbitrary order IDs accepted from clients.
- Production gates (all mandatory, absent by default):
  - `WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED=true`
  - `WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED=true`
  - `WHATSAPP_ORDER_GLOBAL_LAUNCH_ACK=verified_opt_in_orders_v1`
  - `WHATSAPP_ORDER_CONFIRMATION_NOT_BEFORE=<canonical UTC timestamp before a NEW test order>`
  - `WHATSAPP_ORDER_INTERNAL_TOKEN=<new dedicated random 40+ secret>`
  - Existing `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_ALLOWED_TEMPLATES` (contains Meta-approved `order_status_update`) and Supabase server credentials.
- Meta approved order status template expected exactly: body variables `{{1}}` customer name, `{{2}}` display order ID, `{{3}}` label `Confirmed`; language `en`. **Re-verify template status in Meta Manager before launch**, and Cloudflare runtime secret presence independently.
- If Meta accepts, save its real `wamid.*` provider ID, status `accepted`; signed `statuses[]` callback later moves to delivered/read/failed. Meta acknowledgement is **not** receipt on customer's phone.
- If Meta rejects, times out, or the result is uncertain, the event stays attempted (`failed`/`blocked`) and is never automatically resent. Do NOT manually requeue without confirming provider status.

## Safe rollout
1. Review this PR, run safety CI, review SQL under production migration access.
2. Apply the migration on a staging Supabase database and validate COD+prepaid staging, no-consent rejection, race/duplicate claims, provider status transitions and role grants. Only then run against production; it does not enqueue old orders by itself.
3. Deploy reviewed Seller Pages code. With no launch flags enabled, sending stays OFF.
4. Test `{"dryRun":true}` with existing `OUTREACH_API_TOKEN` (private operator client only; do not share screenshots of token).
5. Confirm the Meta approved template and customer checkout opt-in persistence; create a NEW legitimate consented buyer order, do not forge previous order consent.
6. Request explicit authorization before turning on new WhatsApp sending. Set the NEW launch flags in Seller Production Cloudflare secrets/variables, plus distinct internal token and cutoff. **Do not turn off any existing email/WhatsApp settings.**
7. First authorized dispatch must be limited to the test buyer; the supplied handler currently handles up to 2 eligible records per tick, so ensure the queue contains only approved/test eligible records before enabling global mode. Do not add an automatic 5-minute cron until a controlled pilot is verified.
8. Verify outbox provider accepted `wamid`, then signed webhook delivered/read; check 24-hour quota and no duplicate provider attempts.

## Remaining work
- The route is a private **dispatcher**, not an automatic scheduler. Wire it to the existing private cron/Vault model only after pilot and authorization, with a WhatsApp-specific secret and independent rate controls.
- Seller new-order alerts, Admin failure alerts, customer shipment/delivery and seller marketing require their own consent, templates and proof; not included in this first step.
- A consent checkbox checked after an order is placed cannot retroactively authorize messages previously attempted, nor can an old buyer's WhatsApp delivery be assumed.

## Signup-once consent design (PR #309)
Customer PR [#309](https://github.com/praveens6050-afk/Fashion_Fussion/pull/309) adds an **unchecked, affirmative transactional WhatsApp consent** on customer/retailer signup and removes the repeated checkout checkbox. Phone OTP verification alone never opts anyone into order messages. Customer orders proceed with email notification even if consent is not given.

To enable this safely, apply **both** SQL migrations from this PR in order: first `whatsapp_order_confirmation_atomic_dispatch.sql`, then `whatsapp_signup_once_transactional_consent.sql`. The latter broadens the existing per-order consent source constraint and installs:
- The service-role-only `finalize_whatsapp_signup_order_updates` RPC. It verifies the authenticated signup's account type, actual OTP challenge/email and unused OTP verification, sets the verified profile phone, stores an opt-in *only if expressly checked*, and consumes the challenge atomically. STOP history takes priority.
- A new AFTER INSERT order trigger that copies *only proven signup consent* to each **future** same-user same-verified-number order; no historical backfill. Existing order-consent and COD/prepaid staging triggers remain the only way into the queue.
- A signed Meta webhook `STOP`/`STOP FASHION` transactional opt-out and `START FASHION UPDATES` explicit re-opt-in, preserving the original ownership proof.

**Deployment order:** migrate backend SQL on a staging database and test first; migrate production SQL before deploying the OTP API change; deploy Seller Pages code; then deploy Customer Pages PR #309; leave the new outbound Meta send gates **OFF** until the later controlled, approved opt-in test and explicit activation. Do not merge Customer changes before Seller OTP + SQL is verified, or email-confirmation-later signups may have phone finalization errors. No launch flags or existing on/off settings were changed while creating these PRs. Existing customer accounts without documented signup consent do **not** get enrolled automatically: add a separate explicit account opt-in path later.

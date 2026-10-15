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

## Read-only prelaunch checks (PR #311; not deployed)
- `GET /api/outreach/whatsapp-health` reports privacy-safe counts for incoming classifications, Meta delivery receipts, opt-ins, staging queue states and launch-gate configuration presence, using operator authorization. It does **not** send messages or alter Supabase.
- `POST /api/outreach/order-preview` with `{"dryRun":true,"orderId":123,"eventType":"order_confirmed"}` requires **both** an active transactional phone opt-in and active order-specific consent bound to the same authenticated order owner and normalized order phone. It rejects cancelled orders, COD without valid confirmation, prepaid without payment verification, historical confirmations older than 24 hours, and shipment events that predate consent. It only previews; never sends.
- GitHub Actions safety tests cover the health check, consent, payment and shipment gates, including no Meta calls or database mutations from the previews. Do not infer delivered customer order messages from generic Meta delivery receipts (which can be OTPs).
- **Production prerequisites currently missing:** `attempt_started_at` in the WhatsApp order outbox, and service-only `claim_whatsapp_order_confirmation(bigint,timestamptz)` RPC. Until the reviewed migration is applied and tested, the dispatcher's current dry run is not expected to work in production. Do not turn on global launch flags or schedule dispatch.
- Seller acquisition templates require their own recorded **marketing** consent; no opt-in is implied by a public seller contact or an unclassified WhatsApp inbound event.

## Pre-launch audit update (15 October 2026)
- Added `seller-panel/sql/whatsapp_prelaunch_readonly_audit.sql`, a **SELECT-only** check for atomic outbox column, claim/finish RPC presence and grants, unique order/event constraint, trigger state, and outbox counts. It was run read-only against production: column absent, both RPCs absent, triggers active, deduplication constraint present, outbox empty. The audit correctly returned `schema_and_grants_ready_for_controlled_staging_test=false`.
- The private `whatsapp-health` endpoint now performs an additional **HEAD-only** probe for `attempt_started_at`. An absent column shows `MIGRATION_REQUIRED`; a present column still requires separate claim/finish RPC and grants verification. No RPC is invoked.
- Supabase's only listed branch was marked `MIGRATIONS_FAILED`, so **no staging database is verified ready for applying migrations**. No migration has been applied to staging or production; no messages sent.

## Isolated SQL and signed-webhook CI (PR #311)
- `seller-panel/tests/sql/whatsapp-fixture.sql` constructs an **ephemeral GitHub Actions PostgreSQL 16** instance with synthetic orders and mock roles; it does not connect to Fashion Fussion Supabase.
- CI applies the **actual proposed** `seller-panel/sql/whatsapp_order_confirmation_atomic_dispatch.sql` **twice**, verifying migration idempotency, then runs `seller-panel/tests/sql/whatsapp-assertions.sql` inside a rollback-only transaction.
- SQL assertions cover no-consent rejection, unverified prepaid, confirmed COD/prepaid, cancellation, mismatched recipient phone, inactive/revoked consent, historical orders, shipping AWB and post-consent timing, COD delivery collection, one claim per event, provider finish once, hourly 5-first-attempt cap, service-only RPC grants, and opt-in-after-checkout stage without sending.
- `seller-panel/tests/whatsapp-signed-webhook.test.mjs` verifies Meta HMAC challenge/signatures, no persistence of unsigned events, signed delivery receipt parsing, seller marketing JOIN/STOP commands, and rejection of malformed/oversized payloads. Mocked transports never call Meta or a real database.
- CI success is **a code-level simulated verification, not a live WhatsApp delivery claim**. A clean actual staging Supabase branch is still required before production migration or launch approval.

## Meta template verification — read-only (PR #311)
- New **private, operator-authenticated** `GET /api/outreach/whatsapp-meta-readiness`; no POST and no Meta message send. Requires the *existing* `OUTREACH_API_TOKEN` as a Bearer token. No secret values go in query strings, logs, or the response.
- Add the **numeric** `WHATSAPP_BUSINESS_ACCOUNT_ID` (WABA ID) to the **Seller Cloudflare Pages production environment** before using this endpoint **after approved deployment**. This is the WABA Account ID, **not** the already configured numeric `WHATSAPP_PHONE_NUMBER_ID`; keep both unchanged. Do not paste the Graph API access token or app secret into chat.
- Uses existing server-side `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ALLOWED_TEMPLATES`. If any configuration is missing, returns `ready:false` without calling Meta.
- Performs fixed-origin Meta Graph API **GET** reads: `/{WABA_ID}/message_templates?name=order_status_update` and `/{WABA_ID}/phone_numbers`. Checks approved `en` utility template, exact static body with exactly three body parameters, no dynamic header/buttons, and matching Phone Number ID in the same WABA. Unexpected/rejected/paused templates, inaccessible results, pagination, or mismatched mapping fail closed. It never creates or edits a template.
- Response deliberately contains only boolean checks and issue codes, **not** Meta access tokens, phone numbers, buyer PII, business IDs or raw provider error details. Meta GET access alone does **not** prove sender permission, recipient consent, a successful WhatsApp delivery or webhook subscription health.
- CI mocks Meta reads and asserts no POST requests, unauthenticated access rejected, missing ID blocked, approved template allowed, incorrect language/category/body/phone/rejected or paginated results blocked, and Meta API errors fail closed.
- Meta's own Cloud API reference describes read-only phone-number and template retrieval: https://www.postman.com/meta/whatsapp-business-platform/request/e9ady51/get-phone-numbers and https://www.postman.com/meta/whatsapp-business-platform/request/7whkjje/get-template-by-name-default-fields.
- **No new production Cloudflare variable was added in this PR**. Existing live WhatsApp, Sales Zoho Mail and Orders Zoho Mail secrets have not been changed.

## Operator WhatsApp readiness page — no sending
- The proposed UI at `https://seller.fashionfussion.in/whatsapp-readiness.html` is **not live until the draft PR is separately deployed**. It uses the existing private outreach bearer token entered by the operator only on the official seller domain.
- A single button requests only same-origin `GET /api/outreach/whatsapp-health` and `GET /api/outreach/whatsapp-meta-readiness`. It clears the input before sending requests and never stores credentials in cookies, browser storage, HTML URLs, logs or results.
- It shows safe read-only counts, launch-gate presence and Meta template check results. There is no ability to send, queue, retry, stage, opt-in, change an environment variable, or activate order messages from this page.
- The separate `WHATSAPP_BUSINESS_ACCOUNT_ID` value must be confirmed from Meta WhatsApp Manager. **Do not guess it from the phone number ID**; neither the operator page nor the preflight exposes this identifier or secret values.
- A positive template preflight means **only** Meta's read configuration matches; checkout consent, database migration, opt-in proof, webhook subscription and actual customer delivery must still pass independent checks.

## Meta template screenshot review — 15 October 2026
- The Meta template edit screenshot shows a **static TEXT header** `Fashion Fussion`, the three-variable order status body and a `Fashion Fussion` footer. This does **not** independently verify the template's **name, approval status, category or language**; those must be checked in Meta Template Library or with the read-only WABA preflight after approved deployment.
- The read-only `whatsapp-meta-readiness` checker has been adjusted to accept **exactly** this static text header (no dynamic header parameter) and the static footer, while rejecting media headers, variable headers, unrecognized branded headers and button components. The order send route still sends **three BODY parameters only**, because static text headers need no Meta parameters.
- The screenshot shows a **Submit for review** action on an edit page. Avoid submitting an unnecessary edit or changing an already-approved template simply to match the code. No template changes or Meta sends were made.
- New mock-only automated tests exercise matching header+body+footer, dynamic/media/wrong static headers and extra buttons. Template approval remains unverified until a live **GET-only** Meta check is performed.

## Meta Template Library verification — 15 October 2026 (operator screenshot)
- The user provided an additional **template details** screenshot of the existing `order_status_update` English template in Meta WhatsApp Manager. It explicitly shows **Utility** and **Active — Quality Pending**. Quality pending means the active template does not yet have a sufficient quality rating; it is not itself a rejection or pause.
- The preview includes the static **Fashion Fussion** header/footer and body text corresponding to customer name `{{1}}`, display order ID `{{2}}`, and status `{{3}}`; the synthetic sample shown as `Shipped` does not establish a production order notification or delivery.
- **UI template identity/category/language/active state: manually reviewed.** The backend `APPROVED` status value, actual Meta Graph API access, WABA membership, live Cloudflare WABA environment binding, and template delivery are **not independently confirmed**; use private GET-only Meta preflight for those after separately authorized deployment.
- Do not resubmit or edit the existing active Meta template; don't enable automatic sending, scheduler or historical backfill solely based on screenshot verification.

## Checkout RPC least-privilege hardening — additional draft review
- The proposed atomic SQL migration now explicitly revokes `public.record_checkout_whatsapp_consent(bigint)` execute from `PUBLIC` and `anon`, granting only `authenticated`. The function remains `SECURITY DEFINER` and still verifies `auth.uid()`, confirmed COD/verified prepaid state, exact order owner and phone, and explicit checkout selection.
- Isolated PostgreSQL SQL contract now asserts that anonymous access to checkout opt-in is denied, authenticated access is available, and internal stage/claim/finish RPCs are unavailable to `anon` or `authenticated`.
- Existing **production RPC permissions have not been touched**. Applying reviewed SQL in production is a later explicit release decision after a healthy Supabase staging run and no-send pilot approval.
- A provided WABA ID configured in Cloudflare does not prove Meta GET token permissions or Phone Number ID membership. The private Meta verification endpoint remains code-only in this Draft PR; no live Meta API call was made.

## Mandatory live Meta preflight before any future order claim (code only)
- The private **order-confirmation dispatcher** now reuses the same WABA/Phone Number ID/template checker as the private operator readiness endpoint. On a dispatch with eligible unattempted queue candidates, it issues fixed-origin **Meta GETs** for `order_status_update` and phone number membership **before** invoking `claim_whatsapp_order_confirmation`.
- If `WHATSAPP_BUSINESS_ACCOUNT_ID` is missing, the Meta API denies access, the template is paused/not approved, body/static header variables mismatch, the assigned phone is not in that WABA or the Meta response cannot be fully verified, the dispatcher fails closed with **HTTP 423, zero claims and zero sends**. No pending order is poisoned by the failed preflight.
- An empty queue incurs **no Meta reads, order claims or WhatsApp sends**. Operator `dryRun:true` remains a Supabase-only preview and never invokes Meta.
- This is an additional **defense-in-depth** check, not a replacement for existing private 40-character internal dispatch token, Cloudflare launch flags, atomic SQL quota controls, per-order consent checks, Meta `wamid` tracking, or signed webhook receipts.
- CI uses mock GET/POST transports to prove approved exact template+phone permits a single synthetic dispatch, and missing WABA, paused template, mismatched phone or Meta 403 all block database claims and Meta sends. This does not prove a real Meta token works; **no live Meta GET or send was performed**.
- Seller onboarding remains **consent-gated**: current production ledger shows zero active marketing opt-ins, so do not send cold WhatsApp invitations based only on public shop phone numbers. Admin WhatsApp alerts still require a separately approved purpose/template, authorized recipients and a dedicated workflow.

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

# Fashion Fussion Seller Outreach

**Cloudflare Pages Functions location:** this folder is under `seller-panel/functions/` because the Pages project uses `seller-panel` as its Root directory. The build excludes `functions/` from static `dist/` intentionally; Cloudflare packages these functions separately.

This is the deployed copy of the outreach API. Keep any repository-root documentation in sync if you change the APIs.

Server-side Cloudflare Pages Functions for targeted seller invitations. These endpoints are internal-only and require `Authorization: Bearer <OUTREACH_API_TOKEN>`.

## Endpoints

- `POST /api/outreach/email` — send up to 25 Zoho Mail invitations per request.
- `POST /api/outreach/whatsapp` — send up to 25 approved WhatsApp template messages per request.
- `GET /api/outreach/health` — report which required secrets are configured without exposing secret values.

## Cloudflare secrets / variables

### Shared

- `OUTREACH_API_TOKEN` — long random internal bearer token. Store as a Cloudflare secret, never in source control or browser JavaScript.

### Zoho Mail

Required:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_MAIL_ACCOUNT_ID`
- `ZOHO_MAIL_FROM_ADDRESS`

Optional India defaults:

- `ZOHO_ACCOUNTS_BASE_URL=https://accounts.zoho.in`
- `ZOHO_MAIL_BASE_URL=https://mail.zoho.in`

The Zoho OAuth grant must include `ZohoMail.messages.CREATE` (or `ZohoMail.messages.ALL`). Use the data-center URLs matching the mailbox. Fashion Fussion currently expects India DC by default.

### WhatsApp Cloud API

Required:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_VERSION` — set this to the Graph API version currently configured/supported by the Meta app, e.g. `vXX.X`.
- `WHATSAPP_ALLOWED_TEMPLATES` — comma-separated **Meta-approved** template names authorized for this internal API. Mandatory for live sending; choose from WhatsApp Manager; do not guess names.

The endpoint deliberately sends template messages only. Use an approved seller-invitation template for business-initiated conversations and respect opt-outs.

## Email request

```json
{
  "messages": [
    {
      "to": "sales@example.com",
      "subject": "Invitation to sell on Fashion Fussion",
      "mailFormat": "html",
      "content": "<p>Hello...</p><p>Seller registration: https://seller.fashionfussion.in/login</p><p>If you do not want seller invitations from us, reply STOP.</p>"
    }
  ]
}
```

## WhatsApp preflight (no messages sent)

This authenticated dry-run validates the message structure, recorded consent metadata, template allowlist and server configuration. It **never calls Meta**. Replace the example template name with one approved in WhatsApp Manager.

```json
{
  "dryRun": true,
  "messages": [
    {
      "to": "919876543210",
      "templateName": "your_approved_template",
      "languageCode": "en",
      "components": [],
      "consent": {
        "given": true,
        "source": "website_checkout",
        "purpose": "transactional",
        "recordedAt": "2026-10-13T10:00:00.000Z"
      }
    }
  ]
}
```

### Live sending

To send through the same protected endpoint, omit `dryRun` or set it to `false`. The endpoint requires ALL of:

1. A valid `OUTREACH_API_TOKEN` in the Authorization header.
2. A valid numeric Meta Phone Number ID, access token and Graph API version in Cloudflare.
3. An approved template name present in `WHATSAPP_ALLOWED_TEMPLATES`.
4. Explicit recorded consent metadata **for each recipient**. A phone number or a successful signup OTP is not evidence of marketing opt-in.

**Important:** Consent metadata in an API request is NOT sufficient: the protected backend also requires an active, matching opt-in in the server-only Supabase consent ledger (same phone, purpose, source and timestamp). Do not expose the outreach token to browsers. Always honor opt-outs; automated order-event dispatch has not been enabled.

To prepare a seller invitation, use a `marketing` consent purpose and document the WhatsApp marketing opt-in. For order/shipping updates, use `transactional` consent and send only when real order/shipment state is verified. A public business contact number alone is not WhatsApp opt-in.

## Safety / outreach rules

- For WhatsApp, send only after explicit opt-in for the correct purpose; public contact details by themselves are not consent.
- Prefer role-based business emails (`sales@`, `info@`, etc.) where suitable.
- Do not send duplicate invitations to the same business in the same campaign.
- Honor unsubscribe/STOP requests and suppress those contacts from future outreach.
- Keep initial batches small and review bounce/reply/complaint signals before increasing volume.
- Do not expose Zoho, Meta, or internal outreach credentials to the frontend.

## Authoritative consent ledger (2026-10-13)

Supabase migration `whatsapp_contact_consent_ledger_20261013` establishes service-role-only `whatsapp_contact_consents`. Migration `whatsapp_consent_signed_keyword_events_20261013` adds an idempotent `whatsapp_consent_events` history and `record_whatsapp_consent_command` RPC. The signed Meta WhatsApp webhook accepts exact text `JOIN FASHION SELLER` as explicit marketing opt-in and `STOP` / `STOP FASHION` as marketing opt-out. It uses Meta event timestamps and does not let stale replayed events revive consent. Do not treat seller OTP, public business contact details, or a regular message as marketing opt-in.

Outreach `dryRun:true` and live sends both check the authoritative ledger, not merely client supplied `consent.given`. On a live send, consent is rechecked immediately before each recipient. An unavailable ledger fails closed. The caller's consent purpose/source/timestamp must match the stored event. No automatic outreach campaign or order-triggered notifications are enabled by this change. Set up explicit transactional consent capture and review approved template parameters before enabling order/shipping notifications. The ledger is empty until genuinely opted-in recipients are recorded. Never supply a fake timestamp or source in an API call.

## Order/shipping notification preview (no sends)

Protected `POST /api/outreach/order-preview` accepts `Authorization: Bearer <OUTREACH_API_TOKEN>` and body `{"dryRun":true,"orderId":123,"eventType":"shipped"}`. Supported events: `order_confirmed`, `shipped`, `out_for_delivery`, `delivered`. It checks authoritative order/payment/fulfilment fields, forward shipment and AWB for delivery events, customer phone, server-only transactional WhatsApp consent, and `order_status_update` allowlist. The response masks the recipient and explicitly returns `sent:0`, `liveSendingEnabled:false`, and `eligible` based on current order/consent readiness. **Even when `eligible:true`, this endpoint never sends.** Meta approved the `order_status_update` template with 3 body text variables: `{{1}}` = `orders.customer_name`, `{{2}}` = `orders.display_order_id`, `{{3}}` = verified event label (`Confirmed`, `Shipped`, `Out for Delivery`, `Delivered`). The preview shows the customer name as `[customer name]` rather than exposing it; the payload builder uses the real server-side value when needed in future. Language code: `en`; no dynamic header or buttons; static footer: `Fashion Fussion`. The general `POST /api/outreach/whatsapp` endpoint explicitly rejects **live** `order_status_update` messages; use a future dedicated verified order-event dispatcher only.

Supabase migration `whatsapp_order_notification_outbox_20261013` establishes a locked-down, deduplicated `whatsapp_order_notification_outbox` table (unique order ID + event type). No database trigger, queue worker, scheduler, or live sender has been enabled. Do not populate the outbox or send notifications until transactional opt-in capture, Meta-approved template parameter mapping, payment/order transition verification, idempotent delivery handling and deployment tests are completed.

## Verified event staging (no sending)

Supabase migration `stage_whatsapp_order_events_without_sending_20261013` installs three triggers: successful payment/order status transitions, forward shipping updates with AWB, and explicit per-order consent recording. Each calls the service-only `stage_whatsapp_order_event(order_id,event_type)` RPC. Eligibility checks active per-order consent, active transactional phone consent, payment/fulfillment state, AWB for shipping, and disallows historical bulk backfill. Uniqueness on `(order_id,event_type)` prevents duplicate staged event types. Entries are `pending_review` **only**; no Meta API sender, scheduler, cron, or delivery callback is enabled.

Protected `GET /api/outreach/order-outbox?limit=10` returns the latest staged events (IDs, type, state, attempt count and timestamps; no phone or customer name). It is bearer-token secured with `OUTREACH_API_TOKEN`, read-only and never sends messages. Until live dispatcher, status webhooks and delivery auditing are reviewed/tested, do not mark queued events as sent and do not enable automatic messaging.


## Meta WhatsApp delivery receipt lifecycle (not sending)

Supabase migration `whatsapp_meta_delivery_receipts_20261013` creates the RLS-protected `whatsapp_delivery_status_events` audit table and the service-only `record_whatsapp_delivery_status` RPC. The same migration adds `provider_sent_at`, `provider_delivered_at`, `provider_read_at`, `provider_failed_at`, `last_provider_status` and a unique provider message-ID index to the order notification outbox.

Meta sends signed `statuses[]` callbacks to the existing `POST /api/webhooks/whatsapp` endpoint, which is shared with incoming messages and JOIN/STOP consent. The webhook now **requires** `WHATSAPP_APP_SECRET` and validates `X-Hub-Signature-256` *before* processing any data. It persists statuses `sent`, `delivered`, `read`, `failed` by Meta message ID and timestamp, with optional numeric error code. The database rejects duplicates, keeps the event history, links statuses to the outbox only where `provider_message_id` matches, and does not roll `read/delivered` backwards when older `sent/failed` callbacks arrive. OTP/non-order delivery statuses may appear in the audit history without an associated order, which is expected.

Use protected read-only `GET /api/outreach/delivery-receipts?limit=10` to inspect the latest statuses (provider message IDs masked). Protected `GET /api/outreach/order-outbox?limit=10` also includes current provider delivery state and timestamps. Both require `Authorization: Bearer <OUTREACH_API_TOKEN>`.

**Sending remains off:** No order dispatcher, scheduler, cron job, payment-email integration or new outbound template sender is activated here. Actual signed Meta delivery callbacks must still be tested after the Cloudflare deployment before claiming end-to-end delivery success. This feature does not change Zoho Mail.

## Zoho transactional email staging (no new emails sent)

Production Supabase migration `zoho_transactional_order_email_staging_20261014` adds service-role-only RLS `zoho_order_email_outbox` and verified order/shipment update staging triggers, unique per `(order_id,event_type)`. Supports `order_confirmed`, `payment_successful`, `shipped`, `out_for_delivery`, `delivered`; checks confirmed customer auth email, paid/COD states, and forward shipment AWB. Does not backfill historical orders. No mail dispatch, cron, or scheduler is enabled by this migration.

Protected `GET /api/outreach/zoho-order-outbox?limit=10` returns staged events without customer email/phone. Requires `Authorization: Bearer <OUTREACH_API_TOKEN>` and returns `liveSendingEnabled:false`. The existing Razorpay `payment.failed` webhook already handles Zoho recovery mail via `payment_recovery_notifications` and remains unchanged. Production review of config differences (`ZOHO_ACCOUNT_ID` and `ZOHO_FROM_EMAIL` in customer backend versus `ZOHO_MAIL_ACCOUNT_ID` and `ZOHO_MAIL_FROM_ADDRESS` in seller outreach), locking/idempotent claims, mail templates and provider delivery must precede activating other transactional email sends. Outlook is not used for outgoing mail.

## Zoho transactional order email template dry-run (never sends)

Protected `POST /api/outreach/zoho-order-preview` accepts `Authorization: Bearer <OUTREACH_API_TOKEN>` and:

```json
{"dryRun":true,"orderId":123,"eventType":"order_confirmed"}
```

Supported `eventType` values are `order_confirmed`, `payment_successful`, `shipped`, `out_for_delivery`, and `delivered`. The preview checks the Supabase order record, payment status and server-side payment verification, latest forward shipment/AWB, staging outbox record, **confirmed** customer auth email matching the order email, and presence of Zoho sender configuration in the **seller** Cloudflare Pages environment. A staged email can be marked ready in the preview only after these checks. It always reports `dryRun:true`, `sent:0`, and `liveSendingEnabled:false`. The email sample masks the customer's name; no actual recipient address is returned. There is no code path for sending from this endpoint.

Template HTML is escaped and links to account-protected order details; it never contains magic-link sign-in credentials or payment collection links. Previews intentionally do not retry the existing Razorpay `payment.failed` recovery email flow.

**Important configuration distinction:** Seller outreach expects `ZOHO_MAIL_ACCOUNT_ID` / `ZOHO_MAIL_FROM_ADDRESS`. Existing customer-panel Razorpay webhook expects `ZOHO_ACCOUNT_ID` / `ZOHO_FROM_EMAIL`. Check each Cloudflare project's own secrets; working seller configuration does not imply customer payment-failed emails are working. Never put secret values into GitHub, screenshots or chat. The health endpoint checks configured variable presence only, not a successful Zoho API send.

Even if a dry-run says `eligible:true`, email sending is still **off**. Before enabling: implement atomic outbox claims, delivery ambiguity handling, opt-out/transactional communication policy checks, and controlled tests with test orders. Do not re-send or backfill historical events without review.

## Verify Zoho credentials without sending email

Protected endpoint: `POST /api/outreach/zoho-verify`. Requires `Authorization: Bearer <OUTREACH_API_TOKEN>` and JSON `{"dryRun":true}`. The server checks all five Zoho secrets, refreshes an OAuth access token using form-encoded **POST** (not query-string secrets), and fetches `GET https://mail.zoho.in/api/accounts` with `ZohoMail.accounts.READ` to confirm `ZOHO_MAIL_ACCOUNT_ID`, `ZOHO_MAIL_FROM_ADDRESS`, and mailbox sending availability. The endpoint **never sends email**, never returns access/refresh tokens or account IDs, and returns `sent:0`. The OAuth check is separate from actual `ZohoMail.messages.CREATE` permission and successful delivery, which require future explicit test sending after sign-off. It is safe to run multiple times.

Possible `issue` responses include `ZOHO_CONFIGURATION_MISSING`, `ZOHO_OAUTH_REFRESH_FAILED`, `ZOHO_ACCOUNT_READ_FAILED`, `ZOHO_ACCOUNT_ID_NOT_FOUND`, `ZOHO_FROM_ADDRESS_NOT_AUTHORIZED`, and `ZOHO_MAILBOX_DISABLED`. A ready result is a **read-only configuration check**, not notification activation.

Security: the existing `POST /api/outreach/email` OAuth request has been changed to place the refresh token and client secret in the `application/x-www-form-urlencoded` **POST body**, never the request URL. Keep sender secrets out of chat, screenshots and logs. If a refresh token was exposed in a prior screenshot, revoke/rotate it before testing production mail.

Cloudflare customer-panel payment-failed email uses separate `ZOHO_ACCOUNT_ID` / `ZOHO_FROM_EMAIL` variable names. Check those separately; the seller Zoho verification endpoint does not verify secrets on the customer Pages project.

## Manual Zoho Mail smoke test from Android Chrome

Mobile-friendly `https://seller.fashionfussion.in/zoho-test.html` (public static page, but both APIs are protected by `OUTREACH_API_TOKEN`) is for an **operator-initiated** test only. The user types the bearer token into the browser (never send it through chat); the page first calls `POST /api/outreach/zoho-verify` with `{"dryRun":true}` to verify account configuration. Only a successful response enables the `Send one test email` button, which calls the existing `POST /api/outreach/email` with exactly one plain test message and operator-supplied recipient. This **sends a real email** only after that second explicit click. It does not activate order-email dispatch, scheduled tasks, or alter the Zoho outbox. Do not use a customer order ID for this manual test.

Security: all requests are same-origin HTTPS; the access token is sent only as an Authorization header to the two existing protected server-side endpoints. Nothing is stored in localStorage, a cookie, a URL or the repository. A successful send clears the token field and blocks further sends; if response outcome is unknown, check Zoho Sent and recipient Inbox before retrying. If the operator no longer knows `OUTREACH_API_TOKEN` because Cloudflare secrets are encrypted, rotate it using Cloudflare's Secrets page only after reviewing other integrations that use the old token. This page is not a substitute for production monitoring.

## Separate Zoho Orders mailbox (not an alias)

**Correction (14 October 2026):** Zoho Admin Console shows five licensed users. `orders@fashionfussion.in` and `sales.team@fashionfussion.in` are **separate Zoho Users / mailboxes** with different account IDs. Previously we incorrectly assumed an alias. Therefore `ZOHO_ORDER_ALIAS_NOT_AUTHORIZED` was the expected result when the Sales account was checked for the Orders sender. **Do not add the already-existing Orders address as a Sales alias or overwrite Sales credentials.**

The existing Sales/outreach sender continues to use `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_MAIL_ACCOUNT_ID` and `ZOHO_MAIL_FROM_ADDRESS`.

For order confirmations, provision these **separate seller Cloudflare secrets** with credentials authorized for the Orders mailbox:

- `ZOHO_ORDERS_CLIENT_ID` — Zoho OAuth client for Orders user
- `ZOHO_ORDERS_CLIENT_SECRET` — associated OAuth secret
- `ZOHO_ORDERS_REFRESH_TOKEN` — confidential refresh token obtained with `orders@fashionfussion.in` access and `ZohoMail.accounts.READ,ZohoMail.messages.CREATE` scopes
- `ZOHO_ORDERS_MAIL_ACCOUNT_ID` — Orders mailbox's Zoho Mail account ID (**not** the Sales mailbox account ID)

The From address is fixed as `orders@fashionfussion.in` in `zoho-order-sender.js`. Both Zoho user accounts are in India data center. Protected `POST /api/outreach/zoho-verify` with `{"dryRun":true,"purpose":"order_confirmation"}` uses **only** these separate Orders credentials, then checks the mailbox's own primary or active sender address. If unset it returns `ZOHO_CONFIGURATION_MISSING`; if the address does not match it returns `ZOHO_ORDERS_ADDRESS_NOT_AUTHORIZED`.

The Android `/zoho-test.html` button is now **Verify Orders mailbox (no send)**. This does not enable the Sales test-send button; the existing separate Sales email test remains unchanged. The order email preview labels this as a separate mailbox. **No order-confirmation sending/dispatcher, cron or backfill is enabled.** Before enabling real order emails, verify the separate OAuth/account and run an explicitly authorized test from the Orders mailbox.

Customer-side Razorpay payment-failure emails have their own Cloudflare deployment variables; this change does not touch them. Revoke/rotate any previously exposed Zoho refresh token before deployment.

## Explicit one-off email from Orders mailbox (manual test only)

`POST /api/outreach/zoho-orders-test-send` is a **separate**, bearer-protected endpoint. It sends one clearly marked **TEST ONLY** email from `orders@fashionfussion.in` using **only** `ZOHO_ORDERS_*` secrets. It never accesses the Sales sender, an order, payment, or the notification outbox.

Use the deployed page at `https://seller.fashionfussion.in/zoho-test.html`: enter the internal `OUTREACH_API_TOKEN`, enter the **fixed** test recipient `ps4038267@gmail.com`, click **Verify Orders mailbox (no send)**, then click the separate **Send one email from orders@** button and confirm the browser prompt. There is NO need to click the legacy **Send one email from Sales** button. The Orders send is disabled until Orders OAuth and sender verification succeed. It stays disabled after any attempt, and the token is cleared. It does not automatically retry ambiguous outcomes.

The Orders test endpoint requires JSON `{"confirmOrdersTestSend":true,"to":"ps4038267@gmail.com"}`. Other destinations, arbitrary email content, and additional fields are rejected. The server refreshes Orders OAuth with a POST body, independently rechecks the Orders account and authorized sender via `GET /api/accounts`, then performs exactly one POST to the Orders account's messages endpoint. HTTP success means Zoho accepted the request, **not** that Gmail received it. Verify actual delivery at the recipient Inbox/Spam and Zoho Orders Sent. No automatic transactional order email notifications or recurring dispatchers are turned on.

## Order confirmation single-attempt database claim — sending OFF

Supabase migration `zoho_order_confirmation_single_attempt_claim_20261014` installs service-role-only RPCs `claim_zoho_order_confirmation(order_id)` and `finish_zoho_order_confirmation(outbox_id,outcome,message_id)`. The claiming RPC can only move a **manually approved** `ready` order-confirmation event into `sending`, and only if it has had zero attempts, no provider ID, a confirmed recipient email matching the order user, and either verified paid/prepaid or confirmed COD status. It also limits the event to recent orders (24 hours). Claim is one atomic SQL update; subsequent calls do not re-claim. Completion marks an accepted provider submission as `sent` or any unknown/rejected outcome as `blocked`, with no automatic retry. These RPCs do not send mail.

**As of this phase:** no service sets staged events to `ready`, no worker calls these RPCs, no cron exists, and no order emails are automatically sent. Do not manually advance live records or call the claim RPC until end-to-end delivery failure handling and privacy checks are reviewed. Zoho Orders mailbox's controlled test email to Gmail has been received, but real order-triggered email delivery is not yet production verified.

## Order confirmation readiness: insert staging and controlled approval, sending OFF

Supabase migration `zoho_order_confirmation_insert_stage_and_review_20261014` adds an **AFTER INSERT** trigger for already-confirmed COD orders; it merely stages `pending_review` and relies on the existing customer email confirmation and order-state checks. Previously the staging mechanism only handled UPDATE events, so valid COD orders inserted directly in `cod_pending` could be missed. It does **not** stage old orders or cause a send.

Service-role-only RPC `approve_zoho_order_confirmation(order_id)` moves a recent, zero-attempt, verified `order_confirmed` event from `pending_review` to `ready`. This action is not called by any frontend or scheduled task. Existing `claim_zoho_order_confirmation` and `finish_zoho_order_confirmation` also remain uninvoked. No email dispatcher has been activated; never manually approve an unreviewed production order.

Protected `GET /api/outreach/zoho-confirmation-status` reports counts for the 100 most recent confirmation outbox rows without customer PII. It always reports `sendingEnabled:false` and `automaticDispatcherEnabled:false`. This is a queue inspection aid, not evidence that Zoho delivery was tested for real orders. Existing Sales and Orders OAuth and manual test-send APIs are unchanged.

## Order confirmation dispatcher foundation (single-order, feature-flagged; scheduler OFF)

Protected `POST /api/outreach/zoho-confirmation-dispatch` implements the real Zoho Orders mailbox sending transport. **As deployed, no messages are automatically sent**: the Cloudflare environment variable `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED` is not configured and only the exact value `true` permits a live request. No Worker cron, database HTTP trigger or post-checkout browser call invokes this endpoint. Do not enable this setting until an eligible, recent verified test order passes end-to-end review.

Request: `Authorization: Bearer <OUTREACH_API_TOKEN>`, Content-Type application/json.

- **Read-only mobile dry-run:** `{"orderId":123,"dryRun":true}` reports whether an order-confirmation event exists, its queue status and the sending flag, without leaking buyer information. The internal `/zoho-test.html` page now has an **Order ID -> Check Order Confirmation (no send)** control.
- **Explicit live request (DISABLED by default):** `{"orderId":123,"confirmSend":true}` only after enabling `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED=true` on the **seller** Pages project. The request is protected by the same internal bearer; never expose the bearer in the customer frontend.

When enabled and explicitly invoked, the server refreshes the **Orders** Zoho OAuth (never Sales), reads the Orders mailbox to verify the sender, then uses service-only `approve_zoho_order_confirmation` and atomic `claim_zoho_order_confirmation`. Those SQL functions revalidate paid/prepaid payment verification or COD, confirmed auth email matching the order email, recent event age, and zero previous attempts. The email address, customer name, order ID and COD/prepaid data come only from the claimed verified database row—not from API request fields. A single Zoho Mail POST sends the `order_confirmed` template using `orders@fashionfussion.in`. `finish_zoho_order_confirmation` records provider acceptance or blocks rejection/unknown results. A missed or ambiguous provider response is **not automatically retried**; investigate Zoho Sent and queue state before any manual action. Accepted does not imply email was delivered to Gmail.

**Operational notes:** Turning on the flag alone does NOT make messages automatic because no scheduler or checkout server integration has been deployed. Do not backfill old events. The current queue is empty and there is no qualifying recent paid/COD order for live verification. A valid controlled order flow plus independent production smoke test is required before any automated trigger or rollout. The read-only `GET /api/outreach/zoho-confirmation-status` reports the flag's current value and explicitly states `automaticDispatcherEnabled:false`.

## Server-to-server verified order event hook (inactive by default)

The customer checkout backend and seller Zoho dispatcher are separate Cloudflare Pages applications. To ensure genuine, post-payment confirmations, the customer server can securely call the seller's protected `POST /api/outreach/zoho-confirmation-dispatch` with only `{"orderId":123,"confirmSend":true}` **after** database order and inventory finalization. It never accepts an address/name/paid-status supplied by a customer.

To authorize this **server-to-server** caller without sharing the general-purpose `OUTREACH_API_TOKEN`, create a NEW random secret of at least 40 characters named `ZOHO_ORDER_EVENT_TOKEN` in both Cloudflare Pages projects (Customer and Seller; exactly the same value). Never include this secret in static JS, HTML, checkout responses, logs, chat or screenshots. Service-token authentication is accepted only by the confirmation dispatcher; the read-only queue preview remains restricted to the existing operator `OUTREACH_API_TOKEN`.

**Two separate kill switches remain OFF until controlled live end-to-end testing is approved:**

- Customer Pages variable `FF_ORDER_EMAIL_HOOK_ENABLED` must equal `true` before it invokes the seller API at all.
- Seller Pages variable `ZOHO_ORDER_CONFIRMATION_SENDING_ENABLED` must equal `true` before any live confirmation event can be approved, claimed or submitted to Zoho.

The existing Sales mailbox, seller outreach API, Zoho Orders credentials and manual Zoho testing remain unchanged. All customer checkout/verification/webhook paths suppress email failures from propagating into order/payment status. The helper times out after 3.5 seconds; it does not retry uncertain outcomes. Supabase staging remains durable, but a missed POST leaves an event at `pending_review`; there is still **no scheduled queue recovery worker**. Monitor the protected outbox status and investigate missed/blocked events manually before production rollout.

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

## Dedicated Zoho sender alias for order confirmation

Fashion Fussion uses `orders@fashionfussion.in` for **order confirmation** emails. The user confirmed this is an alias on the **same Zoho mailbox** that previously passed the seller outreach email test. Therefore use the existing `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` and `ZOHO_MAIL_ACCOUNT_ID`; do **not** create a new OAuth client, account ID or change `ZOHO_MAIL_FROM_ADDRESS` used by seller outreach/sales.

`zoho-order-sender.js` selects `orders@fashionfussion.in` for `order_confirmed` and retains the current sales From address for other event types until separately defined. Protected `POST /api/outreach/zoho-verify` supports `{"dryRun":true,"purpose":"order_confirmation"}`: refreshes the existing OAuth token, reads the existing mailbox, and verifies the alias is listed as an **active sending address** in Zoho's `sendMailDetails`. No email is sent; failed authorization reports `ZOHO_ORDER_ALIAS_NOT_AUTHORIZED`. Default (no purpose) or `purpose:"outreach"` still checks the original sales sender.

Android-friendly `/zoho-test.html` has a dedicated **Verify orders@ alias (no send)** button. It does not enable the existing sales test-send button. Order preview includes the selected sender and clearly marks independent alias verification as necessary. **No automatic order-confirmation sender has been enabled.** Actual alias send/delivery still requires an explicitly approved, controlled test before any outbox dispatcher is activated. Existing payment-failed customer backend uses separate Cloudflare credentials and is not modified by this change.

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

**Important:** Consent metadata in the API request is asserted by the calling trusted server; the endpoint does not verify it against a durable consent database. Do not expose this endpoint to browsers. Until opt-in records, unsubscribe suppression, approved templates and order-event triggers are connected, keep order/shipping automation and seller campaigns disabled.

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

Protected `POST /api/outreach/order-preview` accepts `Authorization: Bearer <OUTREACH_API_TOKEN>` and body `{"dryRun":true,"orderId":123,"eventType":"shipped"}`. Supported events: `order_confirmed`, `shipped`, `out_for_delivery`, `delivered`. It checks authoritative order/payment/fulfilment fields, forward shipment and AWB for delivery events, customer phone, server-only transactional WhatsApp consent, and `order_status_update` allowlist. The response masks the recipient and explicitly returns `sent:0`, `liveSendingEnabled:false`, `eligible:false`. Template parameter mapping still needs verification in Meta.

Supabase migration `whatsapp_order_notification_outbox_20261013` establishes a locked-down, deduplicated `whatsapp_order_notification_outbox` table (unique order ID + event type). No database trigger, queue worker, scheduler, or live sender has been enabled. Do not populate the outbox or send notifications until transactional opt-in capture, Meta-approved template parameter mapping, payment/order transition verification, idempotent delivery handling and deployment tests are completed.

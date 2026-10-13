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

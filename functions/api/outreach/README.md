# Fashion Fussion Seller Outreach

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

## WhatsApp request

```json
{
  "messages": [
    {
      "to": "919876543210",
      "templateName": "fashion_fussion_seller_invitation",
      "languageCode": "en",
      "components": []
    }
  ]
}
```

## Safety / outreach rules

- Use only public business contact details or contacts supplied for business communication.
- Prefer role-based business emails (`sales@`, `info@`, etc.) where suitable.
- Do not send duplicate invitations to the same business in the same campaign.
- Honor unsubscribe/STOP requests and suppress those contacts from future outreach.
- Keep initial batches small and review bounce/reply/complaint signals before increasing volume.
- Do not expose Zoho, Meta, or internal outreach credentials to the frontend.

# Fashion Fussion CRM email + WhatsApp integration

## Current branch-only implementation

- CRM WhatsApp inbound messages use the existing Meta-signed Seller Pages webhook at `/api/webhooks/whatsapp`, which writes to the private Supabase inbound-event table. The CRM inbox reads only events allowed by the database team scope.
- Zoho email intake endpoint: `POST /api/webhooks/zoho-mail` on the Admin/CRM Pages project. It accepts a small normalized JSON payload and writes through the service-role-only `ingest_crm_email_message` RPC.
- The webhook requires a Bearer secret of at least 40 characters in Cloudflare Pages secret `ZOHO_CRM_WEBHOOK_SECRET`. It also requires the existing server-side `SUPABASE_URL` and a server-only `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`). Never put the service-role key in browser variables, HTML, GitHub, or a publishable-key variable.
- Accepted recipient routes are fixed in code: `customer.care@fashionfussion.in` → customer support; `seller.support@fashionfussion.in` → seller support; `sales.team@fashionfussion.in` → sales/marketing; `orders@fashionfussion.in` → admin/order operations only.
- Duplicate provider message IDs are idempotent. The email table and reply outbox have no browser access. The email sender identity and message text are retained for support handling; do not forward sensitive payment credentials or OTPs into CRM.

## Normalized Zoho bridge payload

The authenticated bridge must POST JSON shaped like this (example values are synthetic):

```json
{
  "externalMessageId": "zoho-message-id",
  "from": "buyer@example.com",
  "to": "customer.care@fashionfussion.in",
  "subject": "Order help",
  "text": "Plain-text message body",
  "receivedAt": "2026-10-20T10:30:00.000Z"
}
```

The endpoint does not poll Zoho Mail and does not automatically configure a Zoho trigger. Configure a supported Zoho Flow/custom automation or a trusted server-side forwarding adapter to normalize each incoming message and call this endpoint. Verify the current Zoho plan and available trigger/action before enabling it. Do not expose the webhook secret in a client-side flow. If the chosen Zoho integration cannot keep the secret private, use a trusted server-side bridge instead.

## Replies and safety

- The CRM stages WhatsApp and email reply drafts as `pending_review`. An administrator must explicitly approve them before they can reach `ready`.
- Email replies require an explicit identity review action first. Replies use the team mailbox as `from_email` and the inbound sender as `to_email`.
- Private dispatch endpoints are implemented but default closed:
  - `POST /api/outreach/crm-email-reply-dispatch`
  - `POST /api/outreach/crm-whatsapp-reply-dispatch`
- Both dispatchers require a private internal Bearer token of at least 40 characters, explicit sending-enabled and launch-approved flags, and a fixed launch acknowledgement. Both support `{"replyId":123,"dryRun":true}` and the dry run never claims or sends a message.
- For Zoho email, configure separate mailbox credentials per approved sender. Required prefixes are `ZOHO_CRM_CUSTOMER_CARE`, `ZOHO_CRM_SELLER_SUPPORT`, and `ZOHO_CRM_SALES_TEAM`; each needs `_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH_TOKEN`, and `_MAIL_ACCOUNT_ID`. OAuth must include `ZohoMail.messages.CREATE` or `ZohoMail.messages.ALL`. The dispatcher never sends CRM support replies from `orders@fashionfussion.in`.
- Email gate secrets/vars: `CRM_EMAIL_REPLY_INTERNAL_TOKEN`, `CRM_EMAIL_REPLY_SENDING_ENABLED=true`, `CRM_EMAIL_REPLY_GLOBAL_LAUNCH_APPROVED=true`, and `CRM_EMAIL_REPLY_GLOBAL_LAUNCH_ACK=reviewed_support_reply_v1`.
- WhatsApp gate secrets/vars: `CRM_WHATSAPP_REPLY_INTERNAL_TOKEN`, `CRM_WHATSAPP_REPLY_SENDING_ENABLED=true`, `CRM_WHATSAPP_REPLY_GLOBAL_LAUNCH_APPROVED=true`, and `CRM_WHATSAPP_REPLY_GLOBAL_LAUNCH_ACK=reviewed_support_reply_v1`, plus existing `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_GRAPH_VERSION`.
- Keep all gates closed until production secrets are present, template/window policy is reviewed, and a safe synthetic test passes. WhatsApp replies are only claimable while the inbound message is within the 24-hour customer-service window. A provider-uncertain attempt is never automatically retried.
- The dispatcher records provider acceptance, not inbox delivery. Provider delivery receipts/reconciliation remain a separate validation item.
- Do not deploy or apply migrations until the CRM PR is approved. After deploy, configure the Zoho bridge and secrets privately, run synthetic inbox/dispatcher tests with gates closed, then obtain explicit production cutover approval before enabling any sending gate.

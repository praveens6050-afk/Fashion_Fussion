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

- The CRM can stage WhatsApp and email reply drafts as `pending_review`. The CRM UI does not send either type of message.
- Email replies require an explicit identity review action first. Replies are staged using the team mailbox as `from_email` and the inbound sender as `to_email`.
- A separately reviewed dispatch worker is still required for delivery. It must use the appropriate Zoho mailbox OAuth credentials, sender allowlist, reply-window/policy checks, one-attempt/idempotency controls, and delivery-status reconciliation. WhatsApp replies likewise require a dedicated support-reply dispatcher and Meta template/free-form policy checks. Do not point the order-notification dispatcher at support replies.
- Do not deploy or apply migrations until the CRM PR is approved. After deploy, configure the webhook secret privately, configure the Zoho bridge, then run synthetic inbox tests before any live customer test. Keep outbound sends disabled until dispatcher review and explicit production cutover approval.

# CRM support messaging integration — rollout runbook

This runbook describes the code path added on `crm-development`. It is not proof that the external providers are connected or that production is enabled.

## Current behavior

- Meta WhatsApp inbound webhook writes signed inbound messages to the existing private Supabase inbound-event RPC. The CRM maps customer, seller, and sales/marketing queues from the server-classified sender role.
- Zoho email intake accepts a normalized event only at `POST /api/webhooks/zoho-mail` and only with a bearer token configured as `ZOHO_CRM_WEBHOOK_SECRET` (minimum 40 characters). The event is deduplicated by Zoho message ID and staged as `needs_review`.
- CRM team members see only their assigned queue. An admin grants team access from the support inbox using the Supabase Auth user UUID.
- Replies start as `pending_review`. Only an admin can approve a reply. Dispatchers are separate, one-attempt, and launch-gated; approval alone does not send.
- No secrets belong in source control or browser variables.

## Cloudflare Pages / Functions server-side variables

Configure only on the CRM Pages project, not in browser-visible variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side secret; never `SUPABASE_PUBLISHABLE_KEY`)
- `ZOHO_CRM_WEBHOOK_SECRET` (random high-entropy secret; minimum 40 characters)

For the authenticated WhatsApp reply endpoint, configure `WHATSAPP_ACCESS_TOKEN` and optionally `WHATSAPP_GRAPH_VERSION` (defaults to `v23.0`); the business phone-number ID is taken from the selected conversation's trusted server-side metadata. Sending remains blocked unless all three dedicated gates are explicitly set: `CRM_WHATSAPP_REPLY_SENDING_ENABLED=true`, `CRM_WHATSAPP_REPLY_GLOBAL_LAUNCH_APPROVED=true`, and `CRM_WHATSAPP_REPLY_GLOBAL_LAUNCH_ACK=reviewed_support_reply_v1`. Leave these gates unset/false until sender configuration, consent/routing policy, approved workflow, and the controlled live-test plan have been reviewed.

For Zoho reply dispatch, configure separate OAuth credentials and Mail account IDs for each CRM sender role using these prefixes: `ZOHO_CRM_CUSTOMER_CARE`, `ZOHO_CRM_SELLER_SUPPORT`, `ZOHO_CRM_SALES_TEAM`, and `ZOHO_CRM_MARKETING`. Each prefix supports `_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH_TOKEN`, `_ACCESS_TOKEN` (only as a pre-issued token fallback), and `_MAIL_ACCOUNT_ID`; optional `_ACCOUNTS_DOMAIN` overrides the global Zoho accounts domain. The sender now selects credentials by the authenticated CRM role and fails closed if that mailbox is not configured. Do not reuse `orders@` credentials for support replies. Do not enable `CRM_EMAIL_REPLY_SENDING_ENABLED` or `CRM_EMAIL_REPLY_GLOBAL_LAUNCH_APPROVED` until all mailbox permissions and sending identities are verified. The global acknowledgement must exactly match `reviewed_support_reply_v1`.

## Zoho inbound forwarding / automation

The webhook expects a normalized JSON POST body:
```json
{
  "externalMessageId": "Zoho's immutable message ID",
  "from": "customer@example.com",
  "to": "customer.care@fashionfussion.in",
  "subject": "Order question",
  "text": "Plain-text message body",
  "receivedAt": "2026-10-20T09:00:00+05:30"
}
```
Send `Authorization: Bearer <ZOHO_CRM_WEBHOOK_SECRET>` over HTTPS. Configure a Zoho Flow/custom function or another server-side Zoho Mail API poller to map incoming messages to this schema. Do not forward arbitrary headers or raw mailbox payloads. Test with a non-customer synthetic message first. The webhook alone does not subscribe to Zoho Mail or fetch inbox messages automatically; the Zoho-side trigger/poller still must be configured and verified.

## Verification order

1. Replay the migrations on disposable local Supabase and run the CRM contract/webhook tests.
2. Deploy to a non-production preview with secrets configured.
3. Verify team access, cross-team denial, duplicate email dedupe, inbound Meta signature rejection, and pending-review queue.
4. Dry-run dispatchers; ensure both report zero messages sent and gates closed.
5. Only after explicit production approval: apply migrations, configure production provider secrets/webhooks, create dedicated test accounts, then run approved end-to-end tests. Live messages require a separate explicit go-ahead.

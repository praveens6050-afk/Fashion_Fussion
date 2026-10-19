# CRM Unified Incoming Inbox

## Department routing
- Customer messages to the configured WhatsApp business number route to **Customer Support** by default.
- A sender matching `public.seller_profiles.phone` routes to **Seller Support**.
- Email sent to `seller-support@...` / `sellerhelp@...` routes to Seller Support; `sales@...`, `wholesale@...`, or `b2b@...` routes to Sales; `marketing@...` or `campaigns@...` routes to Marketing. Other addresses route to Customer Support.
- WhatsApp business phone-number IDs can be mapped with `WHATSAPP_SALES_PHONE_NUMBER_ID` and `WHATSAPP_MARKETING_PHONE_NUMBER_ID` to route messages addressed to those separate business numbers to Sales/Marketing. Without those separate configured numbers, WhatsApp messages route to Customer/Seller Support based on the sender match.
- The inbox UI is loaded only after CRM access is verified. Database RLS restricts each active staff role to its own department; existing admins can audit all departments.

## Required server-side secrets
Configure these only in Supabase Edge Function secrets, never in browser/Pages variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_VERIFY_TOKEN` — a long random verification token you choose and also enter in Meta's webhook configuration.
- `META_APP_SECRET` — the Meta app secret used to verify `X-Hub-Signature-256`.
- `CRM_EMAIL_WEBHOOK_SECRET` — a separate high-entropy secret used to HMAC-sign normalized email webhook request bodies.
- Optional `WHATSAPP_SALES_PHONE_NUMBER_ID` and `WHATSAPP_MARKETING_PHONE_NUMBER_ID` for dedicated numbers assigned to those teams.

## Provider wiring
1. Apply and validate migrations in an isolated Supabase branch first. The current project migration history/schema has known inconsistencies; do not apply this migration directly to production before dependency replay and RLS tests.
2. Deploy `supabase/functions/crm-inbound-webhook/index.ts` only after secret configuration and review. The branch's `supabase/config.toml` sets `verify_jwt = false` for this endpoint because Meta cannot supply a Supabase JWT; the handler itself still verifies Meta's HMAC or the email HMAC. Never expose the service-role key. Set the Meta WhatsApp webhook callback to the deployed function URL; subscribe to the `messages` field and use `WHATSAPP_VERIFY_TOKEN`. The function validates Meta's HMAC signature and is idempotent by provider message ID.
3. Configure Zoho Flow or a trusted email adapter to forward new incoming messages to the same function using the documented normalized payload:
   ```json
   {
     "messages": [{
       "id": "provider-unique-message-id",
       "from_email": "buyer@example.com",
       "from_name": "Buyer",
       "from_phone": "+919999999999",
       "to": "sales@fashionfussion.in",
       "subject": "Wholesale catalogue",
       "text": "Please share bulk pricing",
       "thread_id": "provider-thread-id",
       "provider": "zoho"
     }]
   }
   ```
   Sign the exact raw JSON request body as lowercase hex HMAC-SHA256 with `CRM_EMAIL_WEBHOOK_SECRET`, and send `X-FF-Inbox-Signature: sha256=<hex>`. Use a trusted server-side adapter if Zoho Flow cannot generate this signature; do not disable verification.
4. Test customer and seller WhatsApp senders, each email alias, duplicate webhook delivery, invalid signatures, and cross-role isolation. Verify messages appear in the matching CRM team inbox.

## Scope and safety
- Inbox is read-only in this implementation; it does not send replies or automate campaigns.
- WhatsApp media is represented by a message-type placeholder; media download/secure preview is not implemented.
- The UI refreshes every 30 seconds and can be manually refreshed. It does not depend on Supabase Realtime publication.
- No secrets were added to the repository. No migration or Edge Function was applied/deployed to the connected production project.

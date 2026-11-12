# Fashion Fussion AI Orchestrator

An isolated Cloudflare Worker control plane for the ten Fashion Fussion agents. It is intentionally separate from the Customer, Seller and CRM Pages deployments.

## Current safety state

- The ten agent definitions and per-agent action allowlists are registered in code.
- `GET /health` is public and reports whether execution has been enabled.
- `GET /v1/agents` requires `AGENT_API_TOKEN`.
- `src/agent-runner.js` adds a Workers AI inference adapter for all ten agent roles; the queue consumer invokes it for enabled, queued runs.
- `src/privacy.js` redacts sensitive fields and common PII patterns in free-text inputs before persistence and inference.
- The queue consumer implementation checks per-agent enablement, atomically claims runs, records audit events, and retries transient inference or audit failures with a bounded attempt count. Queue bindings are not attached to the preview deployment yet.
- Model output is draft-only.
- Financial, identity, compliance, outbound-delivery and irreversible actions are approval-gated.
- No agent is enabled by default. The inference adapter is not yet connected to a queue consumer.
- `POST /v1/runs` remains deliberately disabled until the queue consumer, Supabase schema, secrets and agent integrations are ready.
- The Worker does not send WhatsApp, email, voice calls, social posts, refunds, payouts or ads by itself.

## Required bindings and secrets before activation

- `AI` — Cloudflare Workers AI binding.
- `AI_MODEL` — optional model override; default is `@cf/zai-org/glm-4.7-flash`.
- `SUPABASE_URL` — existing Fashion Fussion Supabase project URL.
- `SUPABASE_ANON_KEY` — public client key for the user-scoped Customer Support preview endpoint.
- `SUPABASE_SERVICE_ROLE_KEY` — Cloudflare Worker secret; never expose to browser code.
- `AGENT_API_TOKEN` — strong service-to-service bearer token stored as a Worker secret.
- `AGENT_JOBS` — Cloudflare Queue producer binding.
- `AGENT_RUNTIME_READY=true` — set only after a queue consumer and every enabled handler have passed tests.
- `ALLOWED_ORIGINS` — optional comma-separated additional origins.

## Local checks

```sh
npm test
npm run check
```

## Deployment sequence

1. Review and approve the Supabase control-plane migration in `supabase/migrations`; it has not been applied by this implementation.
2. The Cloudflare Queues `fashion-fussion-agent-jobs` and `fashion-fussion-agent-jobs-dlq` have been provisioned in the connected account; attach the preview Worker as producer/consumer only after secret configuration and preview checks.
3. Complete preview deployment and verify queue consumer attachment, dead-letter routing, and retry behavior.
4. Add secrets through Wrangler or the Cloudflare dashboard.
5. An isolated Worker script `fashion-fussion-ai-orchestrator-preview` has been uploaded with the AI binding and runtime disabled. It is separate from the production social publisher. Endpoint HTTP verification is still pending.
6. Run auth, idempotency, RLS, queue retry, privacy and approval tests.
7. Enable agents individually; do not turn on the global runtime switch until all required checks pass.

Do not point this Worker at production customer data or enable external actions until the migration and integration tests are explicitly approved.

## Customer Support Agent — first vertical slice

The preview-only endpoint `GET /v1/support/tickets/{ticketCode}/assist` verifies the caller's Supabase Auth access token, then reads `support_tickets` and `support_ticket_messages` using that same user JWT and the Supabase anon key. Supabase RLS remains the authorization boundary; the endpoint does not use the service-role key.

It returns deterministic issue triage, escalation guidance and a response draft. This first slice is draft-only: it does not write ticket data, send messages, or change order/refund state. Test with customer, seller and customer-care roles before wiring the UI.


## Seller Management Agent — first vertical slice

The preview-only endpoint `GET /v1/seller/onboarding/assist` verifies the Supabase Auth user token and reads the caller's seller profile, compliance status and product submissions through the same JWT and Supabase anon key. Existing RLS policies enforce seller ownership. It deliberately excludes payout/bank records and PAN/GST identifiers, and cannot approve sellers, change bank details, or activate accounts. Output is a read-only onboarding checklist.

Both support and seller endpoints require `SUPABASE_URL` and `SUPABASE_ANON_KEY`. They do not use the service-role key. Keep them in preview until role-based integration tests pass against real customer, seller and staff test accounts.


## Sales & Conversion Agent — first vertical slice

`GET /v1/products/recommendations?q=...` reads active public catalog rows through the Supabase anon policy and returns a small product shortlist. It does not expose cost or internal margin fields.

## Order & Backend Operations Agent — first vertical slice

`GET /v1/orders/{displayOrderId}/assist` verifies the customer Supabase Auth token and uses that same JWT for the order lookup. The existing `orders` SELECT policy limits customers to their own orders and admins to their permitted view. The response excludes payment-provider identifiers, customer contact details and shipping address. It is read-only and cannot cancel, refund or modify fulfilment.

These endpoints are guidance surfaces only. Do not use them as a substitute for checkout, payment-provider verification, carrier tracking or the existing order-management workflow.


## Additional specialist agent endpoints — aggregate or draft-only

All endpoints below require the AGENT_API_TOKEN bearer token and are not enabled for public browser access:

- GET /v1/marketing/overview — aggregates social publish history and queued campaign counts; no customer contact data.
- GET /v1/leads/consent-overview — counts enquiry consent, promotional consent and opt-outs without returning lead IDs or contact fields.
- GET /v1/trust/review-overview — summarizes order/refund and seller status signals for human review; it does not label anyone fraudulent or take action.
- GET /v1/business/overview — returns capped aggregate order, catalog and seller metrics, not row-level records.
- POST /v1/content/duplicate-check — checks supplied caption/image hashes against up to 1000 queued creatives; it does not publish or schedule.
- POST /v1/voice/draft — generates a voice/recruitment draft through Workers AI with no calls, messages or hiring decisions.

The aggregate endpoints use the service-role key only server-side and return summary values. Results are capped to the latest 1000 rows and must not be represented as complete financial or compliance reports. The business overview labels its amount metric as gross paid-order value, not accounting revenue. The content duplicate check covers the queue records returned by the query; production publishing must continue to enforce the existing publish-history deduplication logic.

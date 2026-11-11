# Fashion Fussion AI Orchestrator

An isolated Cloudflare Worker control plane for the ten Fashion Fussion agents. It is intentionally separate from the Customer, Seller and CRM Pages deployments.

## Current safety state

- The ten agent definitions are registered in code.
- `GET /health` is public and reports whether execution has been enabled.
- `GET /v1/agents` requires `AGENT_API_TOKEN`.
- `POST /v1/runs` is deliberately disabled until the queue consumer, Supabase schema, secrets and agent integrations are ready.
- Financial, identity, compliance and irreversible actions are approval-gated even after the runtime is enabled.
- The Worker does not send WhatsApp, email, voice calls, social posts, refunds, payouts or ads by itself.

## Required bindings and secrets before activation

- `SUPABASE_URL` — existing Fashion Fussion Supabase project URL.
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

1. Apply the reviewed Supabase migration in `supabase/migrations`.
2. Create the Cloudflare Queue and its dead-letter queue.
3. Implement and deploy the queue consumer/Workflow handlers.
4. Add secrets through Wrangler or the Cloudflare dashboard.
5. Deploy this Worker to a preview environment.
6. Run auth, idempotency, RLS, queue retry and approval tests.
7. Enable agents individually; do not turn on the global runtime switch until all required checks pass.

Do not point this Worker at production customer data until the migration and integration tests are approved.


## Customer Support Agent — first vertical slice

The preview-only endpoint `GET /v1/support/tickets/{ticketCode}/assist` verifies the caller's Supabase Auth access token, then reads `support_tickets` and `support_ticket_messages` using that same user JWT and the Supabase anon key. Supabase RLS remains the authorization boundary; the endpoint does not use the service-role key.

It returns deterministic issue triage, escalation guidance and a response draft. This first slice is **draft-only**: it does not write ticket data, send messages, or change order/refund state. Configure `SUPABASE_ANON_KEY` as a Worker variable/secret alongside `SUPABASE_URL` for the preview. Test with customer, seller and customer-care roles before wiring the UI.

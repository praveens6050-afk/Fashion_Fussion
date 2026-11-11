# Fashion Fussion AI Orchestrator

An isolated Cloudflare Worker control plane for the ten Fashion Fussion agents. It is intentionally separate from the Customer, Seller and CRM Pages deployments.

## Current safety state

- The ten agent definitions and per-agent action allowlists are registered in code.
- `GET /health` is public and reports whether execution has been enabled.
- `GET /v1/agents` requires `AGENT_API_TOKEN`.
- `src/agent-runner.js` adds a Workers AI inference adapter for all ten agent roles.
- Model output is draft-only. Sensitive input keys are redacted before inference.
- Financial, identity, compliance, outbound-delivery and irreversible actions are approval-gated.
- No agent is enabled by default. The inference adapter is not yet connected to a queue consumer.
- `POST /v1/runs` remains deliberately disabled until the queue consumer, Supabase schema, secrets and agent integrations are ready.
- The Worker does not send WhatsApp, email, voice calls, social posts, refunds, payouts or ads by itself.

## Required bindings and secrets before activation

- `AI` — Cloudflare Workers AI binding.
- `AI_MODEL` — optional model override; default is `@cf/zai-org/glm-5.3`.
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
2. Create the Cloudflare Queue and its dead-letter queue.
3. Implement and test the queue consumer and durable agent runtime.
4. Add secrets through Wrangler or the Cloudflare dashboard.
5. Deploy this Worker to a preview environment only.
6. Run auth, idempotency, RLS, queue retry, privacy and approval tests.
7. Enable agents individually; do not turn on the global runtime switch until all required checks pass.

Do not point this Worker at production customer data or enable external actions until the migration and integration tests are explicitly approved.

## Customer Support Agent — first vertical slice

The preview-only endpoint `GET /v1/support/tickets/{ticketCode}/assist` verifies the caller's Supabase Auth access token, then reads `support_tickets` and `support_ticket_messages` using that same user JWT and the Supabase anon key. Supabase RLS remains the authorization boundary; the endpoint does not use the service-role key.

It returns deterministic issue triage, escalation guidance and a response draft. This first slice is draft-only: it does not write ticket data, send messages, or change order/refund state. Test with customer, seller and customer-care roles before wiring the UI.


## Seller Management Agent — first vertical slice

The preview-only endpoint `GET /v1/seller/onboarding/assist` verifies the Supabase Auth user token and reads the caller's seller profile, compliance status and product submissions through the same JWT and Supabase anon key. Existing RLS policies enforce seller ownership. It deliberately excludes payout/bank records and PAN/GST identifiers, and cannot approve sellers, change bank details, or activate accounts. Output is a read-only onboarding checklist.

Both support and seller endpoints require `SUPABASE_URL` and `SUPABASE_ANON_KEY`. They do not use the service-role key. Keep them in preview until role-based integration tests pass against real customer, seller and staff test accounts.

# Fashion Fussion AI Orchestrator

An isolated Cloudflare Worker control plane for the ten Fashion Fussion agents. It is intentionally separate from the Customer, Seller and CRM Pages deployments.

## Current implementation status

- The ten agent definitions and per-agent action allowlists are registered in code.
- The authenticated control plane exposes the registry and idempotent run intake.
- `src/agent-runner.js` adds a Workers AI inference adapter for all ten agent roles.
- Model output is draft-only. Sensitive input keys are redacted before inference.
- Financial, identity, compliance, outbound-delivery and irreversible actions are marked approval-required.
- No agent is enabled by default. The inference adapter is not yet connected to a queue consumer.
- `POST /v1/runs` remains disabled until the queue consumer, Supabase schema, secrets and agent integrations are ready.
- The Worker does not send WhatsApp, email, voice calls, social posts, refunds, payouts or ads.

## Required bindings and secrets before activation

- `AI` — Cloudflare Workers AI binding.
- `AI_MODEL` — optional model override; default is `@cf/zai-org/glm-5.3`.
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

1. Review and approve the Supabase control-plane migration in `supabase/migrations`; it has not been applied by this implementation.
2. Create the Cloudflare Queue and its dead-letter queue.
3. Implement and test the queue consumer and durable agent runtime.
4. Add secrets through Wrangler or the Cloudflare dashboard.
5. Deploy this Worker to a preview environment only.
6. Run auth, idempotency, RLS, queue retry, privacy and approval tests.
7. Enable agents individually; do not turn on the global runtime switch until all required checks pass.

Do not point this Worker at production customer data or enable external actions until the migration and integration tests are explicitly approved.

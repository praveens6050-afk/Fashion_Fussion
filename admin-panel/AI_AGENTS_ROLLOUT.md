# Fashion Fussion — Ten-agent rollout plan

## Existing production topology

- Customer storefront: Cloudflare Pages project `fashion-fussion-customer`, domains `fashionfussion.in` and `www.fashionfussion.in`, root `customer-panel`, production branch `cloudflare-customer`.
- Seller portal: Cloudflare Pages project `fashion-fussion-seller`, domain `seller.fashionfussion.in`, root `seller-panel`, production branch `cloudflare-seller`.
- CRM/admin: Cloudflare Pages project `fashion-fussion-crm`, domains `crm.fashionfussion.in` and `www.crm.fashionfussion.in`, root `admin-panel`, production branch `crm-development`.
- Shared business database: Supabase project `gmdevprqtvoshbbytsxf` in `ap-south-1`.
- Existing social publishing Worker: `fashion-fussion-social-publisher`.

The customer, seller and CRM Pages projects remain separate. The agents must call the shared server-side API and database; never put service-role keys in browser bundles.

## Target architecture

```text
Customer Panel ─┐
Seller Panel ───┼──> CRM/Admin + Authenticated API
CRM/Admin ──────┘             |
                              v
                   Cloudflare AI Orchestrator
                     |       |       |
                     v       v       v
                   Queues  Workflows AI Gateway
                     |       |       |
                     +-------+-------+
                             |
                             v
                    Existing Supabase Postgres
                             |
             +---------------+----------------+
             |               |                |
          Commerce          CRM           Social/Leads
       orders/products   inbox/quotes     content/history
```

Use the existing Supabase Postgres as the system of record. Do not introduce D1 as a second commerce database. Use Cloudflare Workers for API/orchestration, Queues for asynchronous work, Workflows for durable multi-step runs, AI Gateway for model observability/rate controls, and R2 only for newly generated media artifacts where existing storage is insufficient.

## Ten agents and initial permissions

| Agent | First implementation | Autonomy boundary |
|---|---|---|
| Customer Support | FAQ retrieval, ticket classification, order lookup, response drafts and escalation | Can answer approved FAQs and read authorized order state; never expose another user's order |
| Seller Management | Onboarding checklist, listing assistance, seller support and compliance reminders | Cannot approve KYC, change payout bank details or activate sellers without server authorization |
| Sales & Conversion | Product recommendations, quote preparation and abandoned-cart analysis | Cannot change prices, apply discounts outside policy or create payment requests |
| Order & Backend Operations | Order-state summaries, stock alerts, exception routing and reconciliation reports | Refunds, paid-order cancellations and payout release require explicit approval and existing finance controls |
| Marketing | Campaign briefs, audience segmentation, performance summaries and scheduling plans | Paid spend/budget changes require approval; outbound messages require purpose-specific consent and opt-out checks |
| Content Creation | Product copy, original creatives, captions, content calendar and duplicate checks | Organic publishing may be enabled only after Meta tokens, platform policy checks and idempotency tests pass |
| Lead Generation & Follow-up | Seller lead qualification, CRM tasks, draft follow-ups and status updates | Do not scrape restricted sources or send unsolicited messages; respect opt-outs and channel consent |
| Trust & Fraud | Risk signals, duplicate detection, anomaly flags and case summaries | No automatic accusation, account ban, KYC decision or payout hold without deterministic policy and review |
| Business Intelligence | Read-only sales, product, seller and campaign reports | Read-only by default; no mutation of source commerce records |
| Voice & Recruitment | Inbound call triage, callback scheduling, job descriptions and candidate summaries | No outbound call recording without notice/consent; no autonomous hiring/rejection decisions |

## Existing database assets to reuse

The existing database already has commerce, seller, support, CRM, marketing-lead and social-publishing tables, including `orders`, `products`, `seller_profiles`, `seller_product_submissions`, `support_tickets`, `crm_inbox_conversations`, `crm_inbox_messages`, `marketing_leads`, `social_content_queue` and `social_publish_history`.

The new migration adds only an agent registry, run ledger, event log and approval queue. It does not alter existing commerce tables or enable outbound delivery.

## Rollout sequence

1. **Foundation:** review and apply the AI control-plane migration; deploy orchestrator to preview; configure service secrets and queue bindings.
2. **Read-only agents:** Business Intelligence, Trust/Fraud signals, Sales recommendations and Order exception summaries. Add role-scoped queries and audit events.
3. **Support and seller agents:** connect existing CRM inbox/ticket flows, seller onboarding and listing workflows; retain authenticated handoff.
4. **Content and marketing:** connect the existing social publisher, preserve `image_hash` and `caption_hash` uniqueness, and verify no content is published twice across Instagram/Facebook.
5. **Lead and follow-up:** connect CRM lead/task tables and enforce WhatsApp/email consent, opt-out and provider-template rules.
6. **Voice and recruiting:** add a telephony provider, inbound routing, notice/consent handling and calendar integration.
7. **Progressive autonomy:** enable one agent/action at a time after tests, rate limits, monitoring, rollback and cost caps pass.

## Mandatory production gates

- Do not deploy directly to the customer or seller production branches from this feature branch.
- Keep the global runtime switch off until the queue consumer and handlers are deployed.
- All service credentials belong in Cloudflare Worker secrets, never Git.
- Every mutation must be authorized server-side and logged with actor, agent, action and idempotency key.
- Use the existing WhatsApp consent ledger. OTP or account verification is not marketing consent.
- Existing WhatsApp order notifications and Zoho email outboxes are staged workflows; this rollout must not silently activate senders.
- Require approval for refunds, payout releases, bank changes, seller/KYC decisions, account bans, paid-ad budget changes and final hiring decisions.
- Enforce rate limits, retry ceilings, dead-letter handling, retention limits and a kill switch.
- Test RLS isolation, duplicate delivery, webhook replay, prompt injection and cross-tenant access before enabling live actions.

## Acceptance criteria

- All ten agents appear in the admin registry with enabled/disabled status.
- Every run has a unique idempotency key, status history and audit events.
- A repeated request cannot create a second run or publish the same creative twice.
- No agent can bypass existing Supabase RLS, seller ownership, admin checks, payment verification or consent ledgers.
- Production can disable an agent or all agent execution without changing customer checkout or seller catalog functionality.

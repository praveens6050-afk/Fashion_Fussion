const AGENTS = [
  { id: "customer_support", name: "Customer Support", scope: "Customer questions, order lookups, support triage and agent handoff", defaultMode: "assist" },
  { id: "seller_management", name: "Seller Management", scope: "Seller onboarding, listing guidance, compliance task tracking and seller support", defaultMode: "assist" },
  { id: "sales_conversion", name: "Sales & Conversion", scope: "Product discovery, recommendations, cart recovery analysis and conversion assistance", defaultMode: "assist" },
  { id: "order_backend", name: "Order & Backend Operations", scope: "Order status, inventory coordination, exception detection and operational workflows", defaultMode: "assist" },
  { id: "marketing", name: "Marketing", scope: "Campaign planning, audience insights, channel reporting and approved campaign execution", defaultMode: "assist" },
  { id: "content_creation", name: "Content Creation", scope: "Original fashion creatives, captions, product copy and duplicate-safe content planning", defaultMode: "assist" },
  { id: "lead_generation_followup", name: "Lead Generation & Follow-up", scope: "Seller prospecting, lead qualification, CRM updates and consent-aware follow-up drafts", defaultMode: "assist" },
  { id: "trust_fraud", name: "Trust, Verification & Fraud", scope: "Risk signals, duplicate-account detection and suspicious-activity review", defaultMode: "assist" },
  { id: "business_intelligence", name: "Business Intelligence", scope: "Sales, product, seller and campaign reporting with trend analysis", defaultMode: "assist" },
  { id: "voice_recruitment", name: "Voice & Recruitment", scope: "Inbound voice support, callback scheduling, job descriptions and candidate screening", defaultMode: "assist" }
];

const SAFE_ACTIONS = new Set([
  "analyze", "classify", "draft", "summarize", "recommend", "report",
  "score_lead", "prepare_quote", "prepare_proposal", "triage",
  "generate_content", "plan_campaign", "screen_candidate",
  "lookup_order", "lookup_product", "prepare_follow_up"
]);

// These actions always create an approval record. An LLM must never be the
// authority for financial, identity, compliance, or irreversible account changes.
const APPROVAL_ACTIONS = new Set([
  "issue_refund", "cancel_paid_order", "release_payout", "change_bank_account",
  "approve_seller", "reject_seller", "mark_kyc_verified", "suspend_account",
  "block_customer", "block_seller", "increase_ad_budget", "launch_paid_campaign",
  "send_bulk_message", "send_outbound_call", "finalize_hiring"
]);

const DEFAULT_ORIGINS = new Set([
  "https://fashionfussion.in",
  "https://www.fashionfussion.in",
  "https://seller.fashionfussion.in",
  "https://crm.fashionfussion.in",
  "https://www.crm.fashionfussion.in"
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const configured = (env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  const allowed = new Set([...DEFAULT_ORIGINS, ...configured]);
  if (!origin || !allowed.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, idempotency-key",
    "vary": "Origin"
  };
}

function authorized(request, env) {
  const expected = env.AGENT_API_TOKEN;
  const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

function approvalRequired(action) {
  return APPROVAL_ACTIONS.has(action);
}

async function supabaseRequest(env, path, init = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  const response = await fetch(new URL(path, env.SUPABASE_URL), {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`supabase_http_${response.status}:${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

async function createRun(env, record) {
  const inserted = await supabaseRequest(
    env,
    "/rest/v1/ai_agent_runs?on_conflict=agent_id,idempotency_key",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(record)
    }
  );
  if (Array.isArray(inserted) && inserted.length) return { run: inserted[0], duplicate: false };

  const query = new URLSearchParams({
    select: "id,agent_id,action,status,idempotency_key,created_at",
    agent_id: `eq.${record.agent_id}`,
    idempotency_key: `eq.${record.idempotency_key}`,
    limit: "1"
  });
  const existing = await supabaseRequest(env, `/rest/v1/ai_agent_runs?${query.toString()}`);
  if (!Array.isArray(existing) || !existing[0]) throw new Error("idempotency_lookup_failed");
  return { run: existing[0], duplicate: true };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "fashion-fussion-ai-orchestrator", runtimeReady: env.AGENT_RUNTIME_READY === "true" }, 200, cors);
  }

  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, cors);

  if (request.method === "GET" && url.pathname === "/v1/agents") {
    return json({
      agents: AGENTS.map(agent => ({ ...agent, status: "registered_not_enabled" })),
      count: AGENTS.length
    }, 200, cors);
  }

  if (request.method === "POST" && url.pathname === "/v1/runs") {
    if (env.AGENT_RUNTIME_READY !== "true" || !env.AGENT_JOBS) {
      return json({ error: "agent_runtime_not_ready", message: "Execution remains disabled until the queue consumer and agent integrations pass deployment checks." }, 503, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }

    const agent = AGENTS.find(item => item.id === body.agent_id);
    const action = typeof body.action === "string" ? body.action : "";
    const idempotencyKey = request.headers.get("Idempotency-Key") || body.idempotency_key;
    if (!agent) return json({ error: "unknown_agent" }, 400, cors);
    if (!SAFE_ACTIONS.has(action) && !APPROVAL_ACTIONS.has(action)) return json({ error: "action_not_allowed" }, 400, cors);
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) {
      return json({ error: "valid_idempotency_key_required" }, 400, cors);
    }
    const input = body.input ?? {};
    const encodedInput = JSON.stringify(input);
    if (encodedInput.length > 24000) return json({ error: "input_too_large" }, 413, cors);

    const requiresApproval = approvalRequired(action);
    const status = requiresApproval ? "awaiting_approval" : "queued";
    let created;
    try {
      created = await createRun(env, {
        agent_id: agent.id,
        action,
        status,
        idempotency_key: idempotencyKey,
        requested_by: body.requested_by || null,
        source: typeof body.source === "string" ? body.source.slice(0, 80) : "api",
        input
      });
    } catch (error) {
      return json({ error: "run_persistence_failed", detail: String(error.message || error).slice(0, 180) }, 502, cors);
    }

    if (created.duplicate) return json({ run: created.run, duplicate: true }, 200, cors);

    if (requiresApproval) {
      try {
        await supabaseRequest(env, "/rest/v1/ai_agent_approvals", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            run_id: created.run.id,
            action_key: action,
            status: "pending",
            requested_by: body.requested_by || null
          })
        });
      } catch (error) {
        await supabaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${created.run.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "failed", error_code: "approval_record_failed", updated_at: new Date().toISOString() })
        }).catch(() => {});
        return json({ error: "approval_record_failed" }, 502, cors);
      }
      return json({ run: created.run, approvalRequired: true }, 202, cors);
    }

    try {
      await env.AGENT_JOBS.send({ run_id: created.run.id, agent_id: agent.id, action, input });
    } catch {
      await supabaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${created.run.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "failed", error_code: "queue_send_failed", updated_at: new Date().toISOString() })
      }).catch(() => {});
      return json({ error: "queue_send_failed" }, 502, cors);
    }

    return json({ run: created.run, queued: true }, 202, cors);
  }

  return json({ error: "not_found" }, 404, cors);
}

export default { fetch: handle };
export { AGENTS, APPROVAL_ACTIONS, SAFE_ACTIONS };

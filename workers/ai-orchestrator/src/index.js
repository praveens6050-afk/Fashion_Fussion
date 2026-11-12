import { AGENTS, AGENT_ACTIONS, APPROVAL_ACTIONS, SAFE_ACTIONS } from "./agents.js";
export { AGENTS, AGENT_ACTIONS, APPROVAL_ACTIONS, SAFE_ACTIONS } from "./agents.js";
import { handleAgentQueue } from "./queue-consumer.js";
import { redactSensitive } from "./privacy.js";
import { handleOrderAssist, handleProductRecommendations } from "./commerce-agent.js";
import { handleSellerAssist } from "./seller-agent.js";
import { handleSupportAssist } from "./support-agent.js";
import { getMarketingOverview, getLeadConsentOverview, getTrustReviewOverview, getBusinessOverview, checkContentDuplicates, getLeadFollowUpContext } from "./analytics-agent.js";
import { runAgentDraft } from "./agent-runner.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

const DEFAULT_ORIGINS = new Set([
  "https://fashionfussion.in",
  "https://www.fashionfussion.in",
  "https://seller.fashionfussion.in",
  "https://crm.fashionfussion.in",
  "https://www.crm.fashionfussion.in"
]);

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
  if (!response.ok) throw new Error(`supabase_http_${response.status}`);
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

  if (request.method === "GET" && url.pathname === "/v1/products/recommendations") {
    return handleProductRecommendations(request, env, (data, status = 200) => json(data, status, cors));
  }
  const orderMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/assist$/);
  if (request.method === "GET" && orderMatch) {
    return handleOrderAssist(request, env, (data, status = 200) => json(data, status, cors));
  }

  if (request.method === "GET" && url.pathname === "/v1/seller/onboarding/assist") {
    return handleSellerAssist(request, env, (data, status = 200) => json(data, status, cors));
  }

  const supportMatch = url.pathname.match(/^\/v1\/support\/tickets\/([^/]+)\/assist$/);
  if (request.method === "GET" && supportMatch) {
    return handleSupportAssist(request, env, (data, status = 200) => json(data, status, cors));
  }
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, cors);

  if (request.method === "GET" && url.pathname === "/v1/marketing/overview") {
    try { return json({ overview: await getMarketingOverview(env) }, 200, cors); }
    catch { return json({ error: "marketing_overview_unavailable" }, 502, cors); }
  }
  if (request.method === "GET" && url.pathname === "/v1/leads/consent-overview") {
    try { return json({ overview: await getLeadConsentOverview(env) }, 200, cors); }
    catch { return json({ error: "lead_consent_overview_unavailable" }, 502, cors); }
  }
  const leadFollowUpMatch = url.pathname.match(/^\/v1\/leads\/([0-9a-f-]{36})\/follow-up-draft$/i);
  if (request.method === "POST" && leadFollowUpMatch) {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }
    try {
      const context = await getLeadFollowUpContext(env, leadFollowUpMatch[1], body.purpose);
      const result = await runAgentDraft(env, {
        agentId: "lead_generation_followup",
        action: "prepare_follow_up",
        input: { purpose: body.purpose, lead_context: context }
      });
      return json({ draft: result.output, mode: "draft_only", consentVerified: true, sideEffectsPerformed: false }, 200, cors);
    } catch (error) {
      const code = error?.message || "lead_follow_up_draft_unavailable";
      const statuses = { invalid_lead_id: 400, invalid_follow_up_purpose: 400, lead_not_found: 404, lead_opted_out: 403, lead_consent_required: 403 };
      return json({ error: statuses[code] ? code : "lead_follow_up_draft_unavailable" }, statuses[code] || 502, cors);
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/trust/review-overview") {
    try { return json({ overview: await getTrustReviewOverview(env) }, 200, cors); }
    catch { return json({ error: "trust_review_overview_unavailable" }, 502, cors); }
  }
  if (request.method === "GET" && url.pathname === "/v1/business/overview") {
    try { return json({ overview: await getBusinessOverview(env) }, 200, cors); }
    catch { return json({ error: "business_overview_unavailable" }, 502, cors); }
  }
  if (request.method === "POST" && url.pathname === "/v1/content/draft") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }
    if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) return json({ error: "content_input_required" }, 400, cors);
    try {
      const result = await runAgentDraft(env, { agentId: "content_creation", action: "generate_content", input: body.input });
      return json({ draft: result.output, mode: "draft_only", sideEffectsPerformed: false }, 200, cors);
    } catch { return json({ error: "content_draft_unavailable" }, 502, cors); }
  }
  if (request.method === "POST" && url.pathname === "/v1/content/duplicate-check") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }
    try { return json({ duplicateCheck: await checkContentDuplicates(env, body) }, 200, cors); }
    catch (error) {
      const code = error?.message === "valid_caption_or_image_hash_required" ? error.message : "content_duplicate_check_unavailable";
      return json({ error: code }, code === error?.message ? 400 : 502, cors);
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/voice/draft") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }
    try {
      const result = await runAgentDraft(env, { agentId: "voice_recruitment", action: "draft", input: body.input ?? {} });
      return json({ draft: result.output, mode: "draft_only", sideEffectsPerformed: false }, 200, cors);
    } catch { return json({ error: "voice_draft_unavailable" }, 502, cors); }
  }

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
    if (!AGENT_ACTIONS[agent.id]?.has(action) || (!SAFE_ACTIONS.has(action) && !APPROVAL_ACTIONS.has(action))) {
      return json({ error: "action_not_allowed_for_agent" }, 400, cors);
    }
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) {
      return json({ error: "valid_idempotency_key_required" }, 400, cors);
    }
    let enabledAgents;
    try {
      const agentQuery = new URLSearchParams({
        select: "agent_id,enabled",
        agent_id: `eq.${agent.id}`,
        limit: "1"
      });
      enabledAgents = await supabaseRequest(env, `/rest/v1/ai_agent_registry?${agentQuery.toString()}`);
    } catch {
      return json({ error: "agent_registry_unavailable" }, 502, cors);
    }
    if (!Array.isArray(enabledAgents) || !enabledAgents[0]?.enabled) {
      return json({ error: "agent_disabled" }, 403, cors);
    }

    const input = redactSensitive(body.input ?? {});
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
        requested_by: null,
        source: typeof body.source === "string" ? body.source.slice(0, 80) : "api",
        input
      });
    } catch {
      return json({ error: "run_persistence_failed" }, 502, cors);
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
            requested_by: null
          })
        });
      } catch {
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

export default { fetch: handle, queue: handleAgentQueue };
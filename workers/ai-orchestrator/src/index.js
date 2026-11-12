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
  "https://www.crm.fashionfussion.in",
  "https://codex-agent-approval-dashboa.fashion-fussion-crm.pages.dev"
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

async function requireAgentEnabled(env, agentId, cors) {
  try {
    const query = new URLSearchParams({
      select: "agent_id,enabled",
      agent_id: `eq.${agentId}`,
      limit: "1"
    });
    const rows = await supabaseRequest(env, `/rest/v1/ai_agent_registry?${query.toString()}`);
    if (!Array.isArray(rows) || !rows[0]?.enabled) {
      return json({ error: "agent_disabled" }, 403, cors);
    }
    return null;
  } catch {
    return json({ error: "agent_registry_unavailable" }, 503, cors);
  }
}

async function authenticateAdmin(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token || token.length > 8192 || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "admin_authentication_required", status: 401 };
  }

  let user;
  try {
    const response = await fetch(new URL("/auth/v1/user", env.SUPABASE_URL), {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) return { error: "admin_authentication_failed", status: 401 };
    user = await response.json();
  } catch {
    return { error: "admin_authentication_unavailable", status: 503 };
  }
  if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) {
    return { error: "admin_authentication_failed", status: 401 };
  }

  try {
    const query = new URLSearchParams({
      select: "id",
      id: `eq.${user.id}`,
      is_admin: "eq.true",
      limit: "1"
    });
    const rows = await supabaseRequest(env, `/rest/v1/profiles?${query.toString()}`);
    if (!Array.isArray(rows) || !rows.length) return { error: "admin_access_required", status: 403 };
    return { userId: user.id };
  } catch {
    return { error: "admin_authorization_unavailable", status: 503 };
  }
}

async function listAdminApprovals(env, cors) {
  try {
    const query = new URLSearchParams({
      select: "id,run_id,action_key,status,review_note,expires_at,created_at",
      status: "eq.pending",
      order: "created_at.asc",
      limit: "100"
    });
    const approvals = await supabaseRequest(env, `/rest/v1/ai_agent_approvals?${query.toString()}`);
    const rows = Array.isArray(approvals) ? approvals : [];
    if (!rows.length) return json({ approvals: [], count: 0 }, 200, cors);
    const runIds = [...new Set(rows.map((item) => item.run_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id || "")))];
    const runQuery = new URLSearchParams({
      select: "id,agent_id,action,status,created_at",
      id: `in.(${runIds.join(",")})`
    });
    const runs = await supabaseRequest(env, `/rest/v1/ai_agent_runs?${runQuery.toString()}`);
    const byId = new Map((Array.isArray(runs) ? runs : []).map((run) => [run.id, run]));
    return json({
      approvals: rows.map((approval) => ({
        ...approval,
        run: byId.get(approval.run_id) || null
      })),
      count: rows.length
    }, 200, cors);
  } catch {
    return json({ error: "approval_queue_unavailable" }, 502, cors);
  }
}

async function reviewAdminApproval(request, env, approvalId, actorId, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }
  const decision = body.decision;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!["approved", "rejected"].includes(decision)) return json({ error: "invalid_approval_decision" }, 400, cors);
  if (note.length > 2000) return json({ error: "review_note_too_long" }, 400, cors);
  if (decision === "rejected" && !note) return json({ error: "rejection_note_required" }, 400, cors);

  let approval;
  try {
    const query = new URLSearchParams({
      select: "id,run_id,action_key,status,expires_at",
      id: `eq.${approvalId}`,
      limit: "1"
    });
    const rows = await supabaseRequest(env, `/rest/v1/ai_agent_approvals?${query.toString()}`);
    approval = Array.isArray(rows) ? rows[0] : null;
  } catch {
    return json({ error: "approval_lookup_failed" }, 502, cors);
  }
  if (!approval) return json({ error: "approval_not_found" }, 404, cors);

  if (approval.status === "approved" && decision === "approved") {
    // Repeated approval requests may safely retry queue delivery; the consumer
    // claims runs with a compare-and-set status transition, so duplicate messages are harmless.
  } else if (approval.status !== "pending") {
    return json({ error: "approval_already_reviewed" }, 409, cors);
  } else if (Date.parse(approval.expires_at) <= Date.now()) {
    await supabaseRequest(env, `/rest/v1/ai_agent_approvals?id=eq.${approvalId}&status=eq.pending`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "expired" })
    }).catch(() => {});
    return json({ error: "approval_expired" }, 409, cors);
  } else {
    let changed;
    try {
      changed = await supabaseRequest(env, `/rest/v1/ai_agent_approvals?id=eq.${approvalId}&status=eq.pending&expires_at=gt.${new Date().toISOString()}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: decision,
          reviewed_by: actorId,
          review_note: note || null,
          reviewed_at: new Date().toISOString()
        })
      });
    } catch {
      return json({ error: "approval_review_failed" }, 502, cors);
    }
    if (!Array.isArray(changed) || !changed.length) return json({ error: "approval_already_reviewed_or_expired" }, 409, cors);

    const nextRunStatus = decision === "approved" ? "queued" : "cancelled";
    try {
      const run = await supabaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${approval.run_id}&status=eq.awaiting_approval`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: nextRunStatus,
          ...(decision === "rejected" ? { finished_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString()
        })
      });
      if (!Array.isArray(run) || !run.length) return json({ error: "approval_run_state_conflict" }, 409, cors);
    } catch {
      return json({ error: "approval_run_update_failed" }, 502, cors);
    }

    await supabaseRequest(env, "/rest/v1/ai_agent_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        run_id: approval.run_id,
        event_type: decision === "approved" ? "approval_granted" : "approval_rejected",
        detail: { approval_id: approvalId, reviewed_by: actorId }
      })
    }).catch(() => {});
  }

  if (decision === "approved") {
    let runRows;
    try {
      const query = new URLSearchParams({ select: "id,status", id: `eq.${approval.run_id}`, limit: "1" });
      runRows = await supabaseRequest(env, `/rest/v1/ai_agent_runs?${query.toString()}`);
    } catch {
      return json({ error: "approved_run_lookup_failed" }, 502, cors);
    }
    let run = Array.isArray(runRows) ? runRows[0] : null;
    if (run?.status === "awaiting_approval") {
      try {
        const repaired = await supabaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${run.id}&status=eq.awaiting_approval`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status: "queued", updated_at: new Date().toISOString() })
        });
        if (Array.isArray(repaired) && repaired.length) run = repaired[0];
        else return json({ error: "approval_run_state_conflict" }, 409, cors);
      } catch {
        return json({ error: "approval_run_update_failed" }, 502, cors);
      }
    }
    if (!run || run.status !== "queued") return json({ approval: "approved", dispatch: "not_queued" }, 200, cors);
    if (env.AGENT_RUNTIME_READY !== "true" || !env.AGENT_JOBS) {
      return json({ approval: "approved", dispatch: "held_runtime_disabled" }, 200, cors);
    }
    try {
      await env.AGENT_JOBS.send({ run_id: run.id, approval_id: approvalId });
      return json({ approval: "approved", dispatch: "queued" }, 202, cors);
    } catch {
      return json({ approval: "approved", dispatch: "pending_retry", error: "queue_send_failed" }, 503, cors);
    }
  }

  return json({ approval: "rejected", dispatch: "not_started" }, 200, cors);
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

  const agentTokenRoute =
    (request.method === "GET" && ["/v1/marketing/overview", "/v1/leads/consent-overview", "/v1/trust/review-overview", "/v1/business/overview"].includes(url.pathname)) ||
    (request.method === "POST" && ["/v1/content/draft", "/v1/content/duplicate-check", "/v1/voice/draft"].includes(url.pathname)) ||
    (request.method === "POST" && /^\/v1\/leads\/[0-9a-f-]{36}\/follow-up-draft$/i.test(url.pathname));
  if (agentTokenRoute && !authorized(request, env)) return json({ error: "unauthorized" }, 401, cors);

  if (request.method === "GET" && url.pathname === "/v1/products/recommendations") {
    const blocked = await requireAgentEnabled(env, "sales_conversion", cors);
    if (blocked) return blocked;
    return handleProductRecommendations(request, env, (data, status = 200) => json(data, status, cors));
  }
  const orderMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/assist$/);
  if (request.method === "GET" && orderMatch) {
    return handleOrderAssist(request, env, (data, status = 200) => json(data, status, cors),
      () => requireAgentEnabled(env, "order_backend", cors));
  }

  if (request.method === "GET" && url.pathname === "/v1/seller/onboarding/assist") {
    return handleSellerAssist(request, env, (data, status = 200) => json(data, status, cors),
      () => requireAgentEnabled(env, "seller_management", cors));
  }

  const supportMatch = url.pathname.match(/^\/v1\/support\/tickets\/([^/]+)\/assist$/);
  if (request.method === "GET" && supportMatch) {
    return handleSupportAssist(request, env, (data, status = 200) => json(data, status, cors),
      () => requireAgentEnabled(env, "customer_support", cors));
  }
  const approvalReviewMatch = url.pathname.match(/^\/v1\/admin\/approvals\/([0-9a-f-]{36})\/review$/i);
  if ((request.method === "GET" && url.pathname === "/v1/admin/approvals") ||
      (request.method === "POST" && approvalReviewMatch)) {
    if (env.AGENT_APPROVALS_READY !== "true") {
      return json({ error: "approval_api_not_ready" }, 503, cors);
    }
    const admin = await authenticateAdmin(request, env);
    if (admin.error) return json({ error: admin.error }, admin.status, cors);
    if (request.method === "GET") return listAdminApprovals(env, cors);
    return reviewAdminApproval(request, env, approvalReviewMatch[1], admin.userId, cors);
  }

  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, cors);

  if (request.method === "GET" && url.pathname === "/v1/marketing/overview") {
    const blocked = await requireAgentEnabled(env, "marketing", cors);
    if (blocked) return blocked;
    try { return json({ overview: await getMarketingOverview(env) }, 200, cors); }
    catch { return json({ error: "marketing_overview_unavailable" }, 502, cors); }
  }
  if (request.method === "GET" && url.pathname === "/v1/leads/consent-overview") {
    const blocked = await requireAgentEnabled(env, "lead_generation_followup", cors);
    if (blocked) return blocked;
    try { return json({ overview: await getLeadConsentOverview(env) }, 200, cors); }
    catch { return json({ error: "lead_consent_overview_unavailable" }, 502, cors); }
  }
  const leadFollowUpMatch = url.pathname.match(/^\/v1\/leads\/([0-9a-f-]{36})\/follow-up-draft$/i);
  if (request.method === "POST" && leadFollowUpMatch) {
    const blocked = await requireAgentEnabled(env, "lead_generation_followup", cors);
    if (blocked) return blocked;
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
    const blocked = await requireAgentEnabled(env, "trust_fraud", cors);
    if (blocked) return blocked;
    try { return json({ overview: await getTrustReviewOverview(env) }, 200, cors); }
    catch { return json({ error: "trust_review_overview_unavailable" }, 502, cors); }
  }
  if (request.method === "GET" && url.pathname === "/v1/business/overview") {
    const blocked = await requireAgentEnabled(env, "business_intelligence", cors);
    if (blocked) return blocked;
    try { return json({ overview: await getBusinessOverview(env) }, 200, cors); }
    catch { return json({ error: "business_overview_unavailable" }, 502, cors); }
  }
  if (request.method === "POST" && url.pathname === "/v1/content/draft") {
    const blocked = await requireAgentEnabled(env, "content_creation", cors);
    if (blocked) return blocked;
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }
    if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) return json({ error: "content_input_required" }, 400, cors);
    try {
      const result = await runAgentDraft(env, { agentId: "content_creation", action: "generate_content", input: body.input });
      return json({ draft: result.output, mode: "draft_only", sideEffectsPerformed: false }, 200, cors);
    } catch { return json({ error: "content_draft_unavailable" }, 502, cors); }
  }
  if (request.method === "POST" && url.pathname === "/v1/content/duplicate-check") {
    const blocked = await requireAgentEnabled(env, "content_creation", cors);
    if (blocked) return blocked;
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, cors); }
    try { return json({ duplicateCheck: await checkContentDuplicates(env, body) }, 200, cors); }
    catch (error) {
      const code = error?.message === "valid_caption_or_image_hash_required" ? error.message : "content_duplicate_check_unavailable";
      return json({ error: code }, code === error?.message ? 400 : 502, cors);
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/voice/draft") {
    const blocked = await requireAgentEnabled(env, "voice_recruitment", cors);
    if (blocked) return blocked;
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
    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, cors);
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
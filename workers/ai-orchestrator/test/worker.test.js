import test from "node:test";
import assert from "node:assert/strict";
import worker, { AGENTS, AGENT_ACTIONS, APPROVAL_ACTIONS } from "../src/index.js";

const token = "test-agent-token";

test("health endpoint is public and reports runtime disabled by default", async () => {
  const response = await worker.fetch(new Request("https://agent.test/health"), { AGENT_RUNTIME_READY: "false" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "fashion-fussion-ai-orchestrator",
    runtimeReady: false
  });
});

test("agent registry requires bearer authentication", async () => {
  const response = await worker.fetch(new Request("https://agent.test/v1/agents"), { AGENT_API_TOKEN: token });
  assert.equal(response.status, 401);
});

test("authenticated registry exposes ten registered agents", async () => {
  const response = await worker.fetch(new Request("https://agent.test/v1/agents", {
    headers: { authorization: `Bearer ${token}` }
  }), { AGENT_API_TOKEN: token });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.count, 10);
  assert.equal(AGENTS.length, 10);
});

test("each agent has a scoped action allowlist", () => {
  assert.equal(Object.keys(AGENT_ACTIONS).length, 10);
  assert.equal(AGENT_ACTIONS.order_backend.has("issue_refund"), true);
  assert.equal(AGENT_ACTIONS.business_intelligence.has("issue_refund"), false);
  assert.equal(AGENT_ACTIONS.content_creation.has("publish_social_post"), true);
});

test("sensitive actions are approval-gated", () => {
  for (const action of ["issue_refund", "release_payout", "change_bank_account", "mark_kyc_verified", "send_bulk_message", "publish_social_post", "finalize_hiring"]) {
    assert.equal(APPROVAL_ACTIONS.has(action), true);
  }
});

test("run intake remains disabled until runtime bindings are configured", async () => {
  const response = await worker.fetch(new Request("https://agent.test/v1/runs", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      agent_id: "content_creation",
      action: "generate_content",
      idempotency_key: "test-run-0001",
      input: { topic: "summer collection" }
    })
  }), { AGENT_API_TOKEN: token, AGENT_RUNTIME_READY: "false" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "agent_runtime_not_ready");
});


test("aggregate, consent, trust and duplicate-check routes require the agent token", async () => {
  for (const path of [
    "/v1/marketing/overview",
    "/v1/leads/consent-overview",
    "/v1/trust/review-overview",
    "/v1/business/overview",
    "/v1/content/duplicate-check",
    "/v1/content/draft",
    "/v1/leads/123e4567-e89b-12d3-a456-426614174000/follow-up-draft"
  ]) {
    const response = await worker.fetch(new Request(`https://agent.test${path}`, {
      method: path.endsWith("duplicate-check") ? "POST" : "GET",
      headers: path.endsWith("duplicate-check") ? { "content-type": "application/json" } : {},
      body: path.endsWith("duplicate-check") ? "{}" : undefined
    }), { AGENT_API_TOKEN: token });
    assert.equal(response.status, 401, path);
  }
});

test("voice draft route is authenticated and never performs an outbound call", async () => {
  const response = await worker.fetch(new Request("https://agent.test/v1/voice/draft", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ input: { scenario: "customer asks about delivery" } })
  }), {
    AGENT_API_TOKEN: token,
    AI: { run: async () => ({ response: "A short callback script draft." }) }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "draft_only");
  assert.equal(body.sideEffectsPerformed, false);
  assert.equal(body.draft, "A short callback script draft.");
});


test("content draft endpoint returns a draft without publishing", async () => {
  const response = await worker.fetch(new Request("https://agent.test/v1/content/draft", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ input: { theme: "festive collection", format: "Instagram caption" } })
  }), {
    AGENT_API_TOKEN: token,
    AI: { run: async () => ({ response: "A fresh fashion caption draft." }) }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "draft_only");
  assert.equal(body.sideEffectsPerformed, false);
  assert.equal(body.draft, "A fresh fashion caption draft.");
});


test("every direct agent endpoint is blocked while its registry entry is disabled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/rest\/v1\/ai_agent_registry\?/);
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = {
    AGENT_API_TOKEN: token,
    SUPABASE_URL: "https://database.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
  };
  const cases = [
    ["GET", "/v1/products/recommendations"],
    ["GET", "/v1/orders/FF-1234/assist"],
    ["GET", "/v1/seller/onboarding/assist"],
    ["GET", "/v1/support/tickets/TKT-1234/assist"],
    ["GET", "/v1/marketing/overview"],
    ["GET", "/v1/leads/consent-overview"],
    ["POST", "/v1/leads/123e4567-e89b-12d3-a456-426614174000/follow-up-draft"],
    ["GET", "/v1/trust/review-overview"],
    ["GET", "/v1/business/overview"],
    ["POST", "/v1/content/draft"],
    ["POST", "/v1/content/duplicate-check"],
    ["POST", "/v1/voice/draft"]
  ];
  try {
    for (const [method, path] of cases) {
      const response = await worker.fetch(new Request(`https://agent.test${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: method === "POST" ? "{}" : undefined
      }), env);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error, "agent_disabled", path);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("direct agent endpoints fail closed if the registry cannot be read", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("database unavailable", { status: 503 });
  try {
    const response = await worker.fetch(new Request("https://agent.test/v1/business/overview", {
      headers: { authorization: `Bearer ${token}` }
    }), {
      AGENT_API_TOKEN: token,
      SUPABASE_URL: "https://database.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "agent_registry_unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


const adminUserId = "123e4567-e89b-12d3-a456-426614174000";
const approvalId = "223e4567-e89b-12d3-a456-426614174000";
const approvalRunId = "323e4567-e89b-12d3-a456-426614174000";

function adminEnv(extra = {}) {
  return {
    SUPABASE_URL: "https://database.test",
    SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
    AGENT_API_TOKEN: token,
    ...extra
  };
}

test("admin approval queue requires an authenticated admin profile", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id: adminUserId }), { status: 200 });
    if (String(url).includes("/rest/v1/profiles?")) return new Response("[]", { status: 200 });
    throw new Error("unexpected_request");
  };
  try {
    const response = await worker.fetch(new Request("https://agent.test/v1/admin/approvals", {
      headers: { authorization: "Bearer user-access-token" }
    }), adminEnv());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "admin_access_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin can list pending approvals with limited run metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: adminUserId }), { status: 200 });
    if (value.includes("/rest/v1/profiles?")) return new Response(JSON.stringify([{ id: adminUserId }]), { status: 200 });
    if (value.includes("/rest/v1/ai_agent_approvals?")) return new Response(JSON.stringify([{
      id: approvalId, run_id: approvalRunId, action_key: "publish_social_post",
      status: "pending", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-11-12T00:00:00Z"
    }]), { status: 200 });
    if (value.includes("/rest/v1/ai_agent_runs?")) return new Response(JSON.stringify([{
      id: approvalRunId, agent_id: "content_creation", action: "publish_social_post",
      status: "awaiting_approval", created_at: "2026-11-12T00:00:00Z"
    }]), { status: 200 });
    throw new Error("unexpected_request");
  };
  try {
    const response = await worker.fetch(new Request("https://agent.test/v1/admin/approvals", {
      headers: { authorization: "Bearer user-access-token" }
    }), adminEnv());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.approvals[0].run.agent_id, "content_creation");
    assert.equal("input" in body.approvals[0].run, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin approval records reviewer, advances run, and holds dispatch while runtime is disabled", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (value.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: adminUserId }), { status: 200 });
    if (value.includes("/rest/v1/profiles?")) return new Response(JSON.stringify([{ id: adminUserId }]), { status: 200 });
    if (value.includes("/rest/v1/ai_agent_approvals?") && !init.method) return new Response(JSON.stringify([{
      id: approvalId, run_id: approvalRunId, action_key: "publish_social_post",
      status: "pending", expires_at: "2099-01-01T00:00:00Z"
    }]), { status: 200 });
    if (value.includes("/rest/v1/ai_agent_approvals?") && init.method === "PATCH") return new Response(JSON.stringify([{ id: approvalId, status: "approved" }]), { status: 200 });
    if (value.includes("/rest/v1/ai_agent_runs?") && init.method === "PATCH") return new Response(JSON.stringify([{ id: approvalRunId, status: "queued" }]), { status: 200 });
    if (value.includes("/rest/v1/ai_agent_events")) return new Response("", { status: 201 });
    if (value.includes("/rest/v1/ai_agent_runs?") && !init.method) return new Response(JSON.stringify([{ id: approvalRunId, status: "queued" }]), { status: 200 });
    throw new Error("unexpected_request");
  };
  try {
    const response = await worker.fetch(new Request(`https://agent.test/v1/admin/approvals/${approvalId}/review`, {
      method: "POST",
      headers: { authorization: "Bearer user-access-token", "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved", note: "Reviewed and approved for draft processing." })
    }), adminEnv({ AGENT_RUNTIME_READY: "false" }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.approval, "approved");
    assert.equal(body.dispatch, "held_runtime_disabled");
    const approvalPatch = calls.find((call) => call.url.includes("/rest/v1/ai_agent_approvals?") && call.method === "PATCH");
    assert.equal(approvalPatch.body.reviewed_by, adminUserId);
    assert.equal(approvalPatch.body.status, "approved");
    const runPatch = calls.find((call) => call.url.includes("/rest/v1/ai_agent_runs?") && call.method === "PATCH");
    assert.equal(runPatch.body.status, "queued");
    assert.equal(calls.some((call) => call.url.includes("/rest/v1/ai_agent_events")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin rejection requires a note and never dispatches a job", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id: adminUserId }), { status: 200 });
    if (String(url).includes("/rest/v1/profiles?")) return new Response(JSON.stringify([{ id: adminUserId }]), { status: 200 });
    throw new Error("unexpected_request");
  };
  try {
    const response = await worker.fetch(new Request(`https://agent.test/v1/admin/approvals/${approvalId}/review`, {
      method: "POST",
      headers: { authorization: "Bearer user-access-token", "content-type": "application/json" },
      body: JSON.stringify({ decision: "rejected" })
    }), adminEnv());
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "rejection_note_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

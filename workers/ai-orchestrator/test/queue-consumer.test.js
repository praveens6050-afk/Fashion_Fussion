import test from "node:test";
import assert from "node:assert/strict";
import { processAgentMessage } from "../src/queue-consumer.js";

test("queue consumer defers work while runtime is disabled", async () => {
  let retried = false;
  let acked = false;
  const result = await processAgentMessage({
    body: { run_id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123" },
    retry: ({ delaySeconds }) => { retried = delaySeconds === 60; },
    ack: () => { acked = true; }
  }, { AGENT_RUNTIME_READY: "false" });
  assert.equal(result.deferred, true);
  assert.equal(retried, true);
  assert.equal(acked, false);
});

test("queue consumer acknowledges malformed messages without touching the database", async () => {
  let acked = false;
  const result = await processAgentMessage({
    body: { run_id: "not-a-uuid" },
    ack: () => { acked = true; },
    retry: () => assert.fail("should not retry malformed messages")
  }, { AGENT_RUNTIME_READY: "true" });
  assert.equal(result.ignored, true);
  assert.equal(acked, true);
});

test("queue consumer cancels work when the individual agent is disabled", async () => {
  const originalFetch = globalThis.fetch;
  let acked = false;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || "GET" });
    if (path.endsWith("/ai_agent_runs")) {
      return new Response(JSON.stringify([{
        id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123",
        agent_id: "customer_support",
        action: "draft",
        status: "queued",
        input: {}
      }]), { status: 200 });
    }
    if (path.endsWith("/ai_agent_registry")) {
      return new Response(JSON.stringify([{ agent_id: "customer_support", enabled: false }]), { status: 200 });
    }
    return new Response(null, { status: 204 });
  };
  try {
    const result = await processAgentMessage({
      body: { run_id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123" },
      attempts: 1,
      ack: () => { acked = true; },
      retry: () => assert.fail("disabled agents must not be retried")
    }, {
      AGENT_RUNTIME_READY: "true",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only"
    });
    assert.equal(result.reason, "agent_disabled");
    assert.equal(acked, true);
    assert.ok(calls.some(call => call.path.endsWith("/ai_agent_registry")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queue consumer executes enabled agent jobs and records draft output", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  let acked = false;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    if (method === "GET" && path.endsWith("/ai_agent_runs")) {
      return new Response(JSON.stringify([{
        id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123",
        agent_id: "customer_support",
        action: "draft",
        status: "queued",
        input: { order_id: "FF-1001" }
      }]), { status: 200 });
    }
    if (method === "GET" && path.endsWith("/ai_agent_registry")) {
      return new Response(JSON.stringify([{ agent_id: "customer_support", enabled: true }]), { status: 200 });
    }
    if (method === "PATCH" && path.endsWith("/ai_agent_runs")) {
      if ((init.headers?.Prefer || "").includes("return=representation")) {
        return new Response(JSON.stringify([{ id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123" }]), { status: 200 });
      }
      writes.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path.endsWith("/ai_agent_events")) {
      writes.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected database request: " + method + " " + path);
  };
  try {
    const result = await processAgentMessage({
      body: { run_id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123" },
      attempts: 1,
      ack: () => { acked = true; },
      retry: () => assert.fail("successful jobs must be acknowledged")
    }, {
      AGENT_RUNTIME_READY: "true",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      AI: { run: async () => ({ response: "Support response draft." }) }
    });
    assert.equal(result.succeeded, true);
    assert.equal(acked, true);
    assert.ok(writes.some(item => item.status === "succeeded"));
    assert.ok(writes.some(item => item.event_type === "run_succeeded"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queue consumer requeues transient model failures and records retry state", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  let retryDelay = 0;
  let acked = false;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    if (method === "GET" && path.endsWith("/ai_agent_runs")) {
      return new Response(JSON.stringify([{
        id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123",
        agent_id: "customer_support",
        action: "draft",
        status: "queued",
        input: {}
      }]), { status: 200 });
    }
    if (method === "GET" && path.endsWith("/ai_agent_registry")) {
      return new Response(JSON.stringify([{ agent_id: "customer_support", enabled: true }]), { status: 200 });
    }
    if (method === "PATCH" && path.endsWith("/ai_agent_runs")) {
      if ((init.headers?.Prefer || "").includes("return=representation")) {
        return new Response(JSON.stringify([{ id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123" }]), { status: 200 });
      }
      writes.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path.endsWith("/ai_agent_events")) {
      writes.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected database request: " + method + " " + path);
  };
  try {
    const result = await processAgentMessage({
      body: { run_id: "2e6f5a8b-83d5-4f10-a7d9-3a4d8c9f0123" },
      attempts: 1,
      ack: () => { acked = true; },
      retry: ({ delaySeconds }) => { retryDelay = delaySeconds; }
    }, {
      AGENT_RUNTIME_READY: "true",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      AI: { run: async () => { throw new Error("temporary_model_error"); } }
    });
    assert.equal(result.retrying, true);
    assert.equal(acked, false);
    assert.equal(retryDelay, 30);
    assert.ok(writes.some(item => item.status === "queued"));
    assert.ok(writes.some(item => item.event_type === "run_retry_scheduled"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

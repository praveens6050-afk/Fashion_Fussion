import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

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

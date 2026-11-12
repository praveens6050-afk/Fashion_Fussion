import test from "node:test";
import assert from "node:assert/strict";
import { runAgentDraft, redactSensitive } from "../src/agent-runner.js";

test("redacts sensitive fields recursively before model invocation", () => {
  const safe = redactSensitive({
    order_id: "FF-1001",
    customer: { email: "private@example.com", phone: "+919999999999" },
    payment: { card_number: "4111111111111111", status: "paid" }
  });
  assert.equal(safe.order_id, "FF-1001");
  assert.equal(safe.customer.email, "[REDACTED]");
  assert.equal(safe.customer.phone, "[REDACTED]");
  assert.equal(safe.payment.card_number, "[REDACTED]");
  assert.equal(safe.payment.status, "paid");
});

test("redacts personal data embedded in free-text fields", () => {
  const safe = redactSensitive({
    message: "Please call +91 9876543210 or email private@example.com. ID 123456789012."
  });
  assert.match(safe.message, /REDACTED_PHONE/);
  assert.match(safe.message, /REDACTED_EMAIL/);
  assert.match(safe.message, /REDACTED_ID/);
});

test("runs an allowed agent task through Workers AI in draft-only mode", async () => {
  let calledModel;
  let calledPayload;
  const env = {
    AI_MODEL: "@cf/zai-org/glm-4.7-flash",
    AI: {
      run: async (model, payload) => {
        calledModel = model;
        calledPayload = payload;
        return { response: "Here is a factual support draft." };
      }
    }
  };
  const result = await runAgentDraft(env, {
    agentId: "customer_support",
    action: "draft",
    input: { order_id: "FF-1001", customer_email: "private@example.com" }
  });
  assert.equal(calledModel, "@cf/zai-org/glm-4.7-flash");
  assert.match(JSON.stringify(calledPayload), /\[REDACTED\]/);
  assert.equal(result.execution_mode, "draft_only");
  assert.equal(result.side_effects_performed, false);
  assert.equal(result.output, "Here is a factual support draft.");
});

test("marks irreversible or outbound actions as approval-required drafts", async () => {
  const result = await runAgentDraft({ AI: { run: async () => ({ response: "Draft only." }) } }, {
    agentId: "content_creation",
    action: "publish_social_post",
    input: { caption: "New arrivals" }
  });
  assert.equal(result.approval_required, true);
  assert.equal(result.side_effects_performed, false);
});

test("rejects unknown agents and actions outside the agent allowlist", async () => {
  const env = { AI: { run: async () => ({ response: "should not run" }) } };
  await assert.rejects(
    runAgentDraft(env, { agentId: "unknown", action: "draft" }),
    /unknown_agent/
  );
  await assert.rejects(
    runAgentDraft(env, { agentId: "business_intelligence", action: "issue_refund" }),
    /action_not_allowed_for_agent/
  );
});

test("fails closed when Workers AI is not configured", async () => {
  await assert.rejects(
    runAgentDraft({}, { agentId: "customer_support", action: "draft" }),
    /workers_ai_not_configured/
  );
});

test("all ten specialist profiles are available without importing the Worker entrypoint", async () => {
  const { AGENT_ACTIONS } = await import("../src/agents.js");
  assert.equal(Object.keys(AGENT_ACTIONS).length, 10);
  for (const [agentId, actions] of Object.entries(AGENT_ACTIONS)) {
    assert.ok(actions instanceof Set, agentId + " action allowlist must be a Set");
    assert.ok(actions.has("analyze") || actions.has("draft") || actions.has("classify"), agentId);
  }
});

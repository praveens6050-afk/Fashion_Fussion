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

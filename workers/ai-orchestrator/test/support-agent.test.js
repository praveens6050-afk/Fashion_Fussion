import test from "node:test";
import assert from "node:assert/strict";
import { classifySupportTicket, buildSupportAssistResponse } from "../src/support-agent.js";

test("support triage flags payment and refund cases for human review", () => {
  const result = classifySupportTicket({ issue_type: "payment", subject: "Refund not received", priority: "high" });
  assert.equal(result.category, "refund_or_payment");
  assert.equal(result.requiresHumanReview, true);
});

test("urgent safety or fraud signals pause automated replies", () => {
  const result = classifySupportTicket({ issue_type: "account", subject: "unauthorized transaction" });
  assert.equal(result.priority, "urgent_review");
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.suggestedNextSteps[0], "Pause automated replies");
});

test("support draft never promises a refund date", () => {
  const result = buildSupportAssistResponse(
    { ticket_code: "FF-1001", issue_type: "refund", subject: "Refund status", status: "open", channel: "customer_support", created_at: "2026-11-11T00:00:00Z" },
    []
  );
  assert.equal(result.mode, "draft_only");
  assert.match(result.suggestedReply, /verify the payment and refund status/i);
  assert.doesNotMatch(result.suggestedReply, /within \\d+ days/i);
});

test("support classification defaults to general without inventing ticket details", () => {
  const result = classifySupportTicket({ issue_type: "other", subject: "Need help" });
  assert.equal(result.category, "general");
  assert.equal(result.requiresHumanReview, false);
});

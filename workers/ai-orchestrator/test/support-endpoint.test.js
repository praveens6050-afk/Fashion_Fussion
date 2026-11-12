import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("customer support assist requires a Supabase user session", async () => {
  const response = await worker.fetch(
    new Request("https://agent.test/v1/support/tickets/FF-1001/assist"),
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test", SUPABASE_SERVICE_ROLE_KEY: "service-test" }
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "user_authentication_required");
});

test("support assist uses the caller JWT and Supabase RLS, without service-role credentials", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    seen.push({ path: url.pathname, query: url.search, authorization: init.headers.authorization, apikey: init.headers.apikey });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "customer-user-id" });
    if (url.pathname === "/rest/v1/ai_agent_registry") return Response.json([{ agent_id: "customer_support", enabled: true }]);
    if (url.pathname === "/rest/v1/support_tickets") return Response.json([{
      id: 7, ticket_code: "FF-1001", channel: "customer_support", issue_type: "delivery",
      subject: "Where is my delivery?", status: "open", priority: "normal", created_at: "2026-11-11T00:00:00Z"
    }]);
    if (url.pathname === "/rest/v1/support_ticket_messages") return Response.json([]);
    return new Response("not found", { status: 404 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://agent.test/v1/support/tickets/FF-1001/assist", {
        headers: { authorization: "Bearer customer-jwt" }
      }),
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test" }
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.assist.triage.category, "delivery");
    assert.equal(body.assist.mode, "draft_only");
    assert.equal(seen.length, 3);
    assert.match(seen.find((item) => item.path === "/rest/v1/support_tickets").query, /ticket_code=eq.FF-1001/);
    assert.ok(seen.every((item) => item.authorization === "Bearer customer-jwt"));
    assert.ok(seen.every((item) => item.apikey === "anon-test"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

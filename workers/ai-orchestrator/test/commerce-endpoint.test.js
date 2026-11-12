import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("public product recommendations use the anon catalog policy", async () => {
  const originalFetch = globalThis.fetch;
  let requestSeen;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/rest/v1/ai_agent_registry") return Response.json([{ agent_id: "sales_conversion", enabled: true }]);
    requestSeen = { path: url.pathname, authorization: init.headers.authorization, apikey: init.headers.apikey, query: url.search };
    return Response.json([{ id: 9, name: "Cotton Kurta", category: "Ethnic", price: 899, rating: 4.7, reviews: 18, is_active: true }]);
  };
  try {
    const response = await worker.fetch(new Request("https://agent.test/v1/products/recommendations?q=cotton"), {
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test", SUPABASE_SERVICE_ROLE_KEY: "service-test"
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.recommendations.products[0].name, "Cotton Kurta");
    assert.equal(requestSeen.authorization, "Bearer anon-test");
    assert.match(requestSeen.query, /is_active=eq.true/);
  } finally { globalThis.fetch = originalFetch; }
});

test("order assist requires a customer session and uses the caller JWT", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    seen.push({ path: url.pathname, query: url.search, authorization: init.headers.authorization });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "customer-id" });
    if (url.pathname === "/rest/v1/ai_agent_registry") return Response.json([{ agent_id: "order_backend", enabled: true }]);
    if (url.pathname === "/rest/v1/orders") return Response.json([{
      display_order_id: "FF-1001", status: "paid", total_amount: "899", currency: "INR",
      fulfillment_status: "shipped", created_at: "2026-11-11T00:00:00Z",
      fulfillment_updated_at: "2026-11-11T01:00:00Z", payment_method: "UPI"
    }]);
    return new Response("not found", { status: 404 });
  };
  try {
    const missing = await worker.fetch(new Request("https://agent.test/v1/orders/FF-1001/assist"), {
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test"
    });
    assert.equal(missing.status, 401);
    const response = await worker.fetch(new Request("https://agent.test/v1/orders/FF-1001/assist", {
      headers: { authorization: "Bearer customer-jwt" }
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test", SUPABASE_SERVICE_ROLE_KEY: "service-test" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.assist.order.orderNumber, "FF-1001");
    assert.equal(body.assist.mode, "read_only");
    assert.equal(seen[0].authorization, "Bearer customer-jwt");
    assert.match(seen.find((item) => item.path === "/rest/v1/orders").query, /display_order_id=eq.FF-1001/);
  } finally { globalThis.fetch = originalFetch; }
});

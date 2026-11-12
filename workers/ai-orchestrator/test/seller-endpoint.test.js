import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("seller onboarding assistant is scoped by the authenticated Supabase user", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    seen.push({ path: url.pathname, query: url.search, authorization: init.headers.authorization });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "seller-user-id" });
    if (url.pathname === "/rest/v1/ai_agent_registry") return Response.json([{ agent_id: "seller_management", enabled: true }]);
    if (url.pathname === "/rest/v1/seller_profiles") return Response.json([{
      store_name: "Demo Store", seller_code: "FFS-100", status: "active", seller_type: "business"
    }]);
    if (url.pathname === "/rest/v1/seller_compliance_profiles") return Response.json([{
      entity_type: "company", gst_registered: true, verification_status: "pending",
      pan_verification_status: "pending", gst_verification_status: "pending"
    }]);
    if (url.pathname === "/rest/v1/seller_product_submissions") return Response.json([]);
    return new Response("not found", { status: 404 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://agent.test/v1/seller/onboarding/assist", {
        headers: { authorization: "Bearer seller-jwt" }
      }),
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test", SUPABASE_SERVICE_ROLE_KEY: "service-test" }
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.assist.seller.storeName, "Demo Store");
    assert.equal(body.assist.mode, "read_only_assist");
    assert.ok(seen.filter((item) => item.path !== "/rest/v1/ai_agent_registry").every((item) => item.authorization === "Bearer seller-jwt"));
    const complianceRequest = seen.find((item) => item.path === "/rest/v1/seller_compliance_profiles");
    assert.match(complianceRequest.query, /seller_id=eq.seller-user-id/);
    const submissionRequest = seen.find((item) => item.path === "/rest/v1/seller_product_submissions");
    assert.doesNotMatch(submissionRequest.query, /bank|account_number|pan_last4/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

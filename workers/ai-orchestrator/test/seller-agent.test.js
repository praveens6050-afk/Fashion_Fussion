import test from "node:test";
import assert from "node:assert/strict";
import { buildSellerAssistResponse } from "../src/seller-agent.js";

test("seller assistant lists missing compliance without revealing bank or identity details", () => {
  const result = buildSellerAssistResponse(
    { store_name: "Demo Store", seller_code: "FFS-100", status: "pending", seller_type: "business" },
    { entity_type: "company", gst_registered: true, verification_status: "pending", pan_verification_status: "pending", gst_verification_status: "pending" },
    [{ id: 1, sku: "SKU-1", name: "Kurta", status: "needs_changes", submitted_at: "2026-11-11T00:00:00Z", rejection_reason: "Add clearer images" }]
  );
  assert.equal(result.mode, "read_only_assist");
  assert.ok(result.checklist.some((item) => item.key === "pan_verification"));
  assert.ok(result.checklist.some((item) => item.key === "product_submissions"));
  assert.equal(JSON.stringify(result).includes("account_number"), false);
  assert.equal(JSON.stringify(result).includes("pan_last4"), false);
});

test("seller assistant never recommends autonomous seller approval", () => {
  const result = buildSellerAssistResponse(
    { store_name: "Demo Store", seller_code: "FFS-100", status: "pending", seller_type: "individual" },
    null,
    []
  );
  assert.equal(result.seller.status, "pending");
  assert.match(result.note, /cannot approve a seller/i);
});

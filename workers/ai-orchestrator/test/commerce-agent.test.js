import test from "node:test";
import assert from "node:assert/strict";
import { buildProductRecommendations, buildOrderAssist } from "../src/commerce-agent.js";

test("product recommendations return only safe catalog fields and active rows supplied by caller", () => {
  const result = buildProductRecommendations([
    { id: 1, name: "Cotton Kurta", category: "Ethnic", price: 899, rating: 4.5, reviews: 12, is_active: true },
    { id: 2, name: "Denim Jacket", category: "Western", price: 1599, is_active: true }
  ], "cotton kurta");
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, "Cotton Kurta");
  assert.equal(result.mode, "catalog_read_only");
  assert.equal(JSON.stringify(result).includes("cost"), false);
});

test("order guidance is read-only and avoids exposing payment identifiers", () => {
  const result = buildOrderAssist({
    display_order_id: "FF-1001", status: "paid", total_amount: 1299, currency: "INR",
    fulfillment_status: "shipped", fulfillment_updated_at: "2026-11-11T00:00:00Z",
    payment_method: "UPI", refund_status: null, razorpay_payment_id: "secret"
  });
  assert.equal(result.order.orderNumber, "FF-1001");
  assert.equal(result.mode, "read_only");
  assert.match(result.guidance[0], /fulfilment process/i);
  assert.equal(JSON.stringify(result).includes("razorpay"), false);
});

test("cancelled orders do not trigger an automatic refund promise", () => {
  const result = buildOrderAssist({
    display_order_id: "FF-1002", status: "cancelled", fulfillment_status: "cancelled",
    total_amount: 500, currency: "INR", payment_method: "COD"
  });
  assert.match(result.guidance[0], /check the order record/i);
  assert.match(result.note, /cannot cancel orders, issue refunds/i);
});

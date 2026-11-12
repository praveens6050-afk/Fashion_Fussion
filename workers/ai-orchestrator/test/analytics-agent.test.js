import test from "node:test";
import assert from "node:assert/strict";
import {
  getMarketingOverview,
  getLeadConsentOverview,
  getTrustReviewOverview,
  getBusinessOverview,
  checkContentDuplicates,
  getLeadFollowUpContext
} from "../src/analytics-agent.js";

function withRows(rowsByTable, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.split("/").at(-1);
    return new Response(JSON.stringify(rowsByTable[table] || []), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = originalFetch; });
}

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only" };

test("marketing overview returns only aggregate publishing data", async () => {
  await withRows({
    social_publish_history: [{ platform: "instagram", state: "published" }, { platform: "facebook", state: "failed" }],
    social_content_queue: [{ campaign: "new-arrivals", caption_hash: "h1", image_hash: "i1" }]
  }, async () => {
    const result = await getMarketingOverview(env);
    assert.equal(result.publishedOrAttemptedByPlatform.instagram, 1);
    assert.equal(result.publishStates.failed, 1);
    assert.equal(result.queueCount, 1);
    assert.equal(Object.hasOwn(result, "phone"), false);
    assert.equal(Object.hasOwn(result, "lead_id"), false);
    assert.equal(Object.hasOwn(result, "email"), false);
  });
});

test("lead overview counts consent and opt-outs without returning lead identifiers or contact data", async () => {
  await withRows({
    marketing_leads: [
      { whatsapp_enquiry_consent: true, whatsapp_promo_consent: true, opt_out_at: null, status: "new" },
      { whatsapp_enquiry_consent: true, whatsapp_promo_consent: false, opt_out_at: "2026-01-01", status: "closed" }
    ]
  }, async () => {
    const result = await getLeadConsentOverview(env);
    assert.equal(result.enquiryConsentActive, 1);
    assert.equal(result.promotionalConsentActive, 1);
    assert.equal(result.optedOut, 1);
    assert.equal(Object.hasOwn(result, "phone"), false);
    assert.equal(Object.hasOwn(result, "lead_id"), false);
    assert.equal(Object.hasOwn(result, "email"), false);
  });
});

test("trust overview describes review signals and never labels a record fraudulent", async () => {
  await withRows({
    orders: [
      { status: "paid", refund_status: "none", payment_method: "prepaid", payment_verified_at: null },
      { status: "pending", refund_status: "none", payment_method: "cod", payment_verified_at: null }
    ],
    seller_profiles: [{ status: "pending" }]
  }, async () => {
    const result = await getTrustReviewOverview(env);
    assert.equal(result.nonCodOrdersMissingPaymentVerificationTimestamp, 1);
    assert.equal(result.sellerStatuses.pending, 1);
    assert.match(result.note, /not evidence of fraud/i);
  });
});

test("business overview aggregates orders, catalog and sellers without row-level details", async () => {
  await withRows({
    orders: [{ total_amount: "100.50", currency: "INR", status: "paid", fulfillment_status: "processing" }],
    products: [{ is_active: true, category: "women", price: 599, rating: 4.5 }],
    seller_profiles: [{ status: "active" }]
  }, async () => {
    const result = await getBusinessOverview(env);
    assert.equal(result.grossPaidOrderValueByCurrency.INR, 100.5);
    assert.equal(result.productActiveStates.active, 1);
    assert.equal(result.sellerStatuses.active, 1);
    assert.equal(JSON.stringify(result).includes("customer_phone"), false);
  });
});

test("content duplicate check matches caption and image hashes without returning captions", async () => {
  await withRows({
    social_content_queue: [{ content_id: "post-1", caption_hash: "cap-1", image_hash: "img-1" }],
    social_publish_history: [{ content_id: "post-1", platform: "instagram", state: "published", published_at: "2026-11-01T10:00:00Z" }]
  }, async () => {
    const result = await checkContentDuplicates(env, { caption_hash: "cap-1", image_hash: "img-1" });
    assert.equal(result.duplicateCaption, true);
    assert.equal(result.duplicateImage, true);
    assert.deepEqual(result.matchingContentIds, ["post-1"]);
    assert.equal(result.alreadyPublished, true);
    assert.equal(result.publishHistory[0].platform, "instagram");
  });
});

test("content duplicate check rejects an empty query", async () => {
  await assert.rejects(checkContentDuplicates(env, {}), /valid_caption_or_image_hash_required/);
});


test("lead follow-up context requires the matching consent and excludes contact fields", async () => {
  await withRows({
    marketing_leads: [{
      whatsapp_enquiry_consent: true,
      whatsapp_promo_consent: false,
      opt_out_at: null,
      interest: "women's festive wear",
      lead_source: "website",
      status: "new",
      created_at: "2026-11-01T10:00:00Z"
    }]
  }, async () => {
    const result = await getLeadFollowUpContext(env, "123e4567-e89b-12d3-a456-426614174000", "enquiry");
    assert.equal(result.consentVerified, true);
    assert.equal(result.interest, "women's festive wear");
    assert.equal(Object.hasOwn(result, "phone"), false);
    assert.equal(Object.hasOwn(result, "email"), false);
  });
});

test("lead follow-up context blocks missing promotional consent and opted-out leads", async () => {
  await withRows({
    marketing_leads: [{
      whatsapp_enquiry_consent: true,
      whatsapp_promo_consent: false,
      opt_out_at: null
    }]
  }, async () => {
    await assert.rejects(
      getLeadFollowUpContext(env, "123e4567-e89b-12d3-a456-426614174000", "promotion"),
      /lead_consent_required/
    );
  });
  await withRows({
    marketing_leads: [{
      whatsapp_enquiry_consent: true,
      whatsapp_promo_consent: true,
      opt_out_at: "2026-11-01T10:00:00Z"
    }]
  }, async () => {
    await assert.rejects(
      getLeadFollowUpContext(env, "123e4567-e89b-12d3-a456-426614174000", "promotion"),
      /lead_opted_out/
    );
  });
});

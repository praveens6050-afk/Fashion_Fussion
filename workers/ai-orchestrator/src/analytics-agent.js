function groupCount(rows, key) {
  return rows.reduce((result, row) => {
    const value = row?.[key] == null || row[key] === "" ? "unknown" : String(row[key]);
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

async function readRows(env, table, select, limit = 1000, order) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_not_configured");
  const query = new URLSearchParams({ select, limit: String(limit), ...(order ? { order } : {}) });
  const response = await fetch(new URL(`/rest/v1/${table}?${query.toString()}`, env.SUPABASE_URL), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json"
    }
  });
  if (!response.ok) throw new Error(`supabase_http_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("invalid_database_response");
  return rows;
}

export async function getMarketingOverview(env) {
  const [history, queue] = await Promise.all([
    readRows(env, "social_publish_history", "platform,state,published_at", 1000, "published_at.desc"),
    readRows(env, "social_content_queue", "campaign,scheduled_at,caption_hash,image_hash", 1000, "scheduled_at.desc")
  ]);
  return {
    publishedOrAttemptedByPlatform: groupCount(history, "platform"),
    publishStates: groupCount(history, "state"),
    queuedByCampaign: groupCount(queue, "campaign"),
    queueCount: queue.length,
    historyRowsReviewed: history.length,
    mode: "aggregate_read_only",
    note: "This report contains no customer or seller contact details."
  };
}

export async function getLeadConsentOverview(env) {
  const rows = await readRows(env, "marketing_leads", "whatsapp_enquiry_consent,whatsapp_promo_consent,opt_out_at,status,created_at", 1000, "created_at.desc");
  const optedOut = rows.filter(row => row.opt_out_at != null).length;
  const enquiryConsent = rows.filter(row => row.whatsapp_enquiry_consent === true && row.opt_out_at == null).length;
  const promoConsent = rows.filter(row => row.whatsapp_promo_consent === true && row.opt_out_at == null).length;
  return {
    recordsReviewed: rows.length,
    enquiryConsentActive: enquiryConsent,
    promotionalConsentActive: promoConsent,
    optedOut,
    leadStatuses: groupCount(rows, "status"),
    mode: "aggregate_consent_audit",
    note: "No names, phone numbers, email addresses, lead IDs or message content are returned. Counts are limited to the latest 1000 records."
  };
}

export async function getTrustReviewOverview(env) {
  const [orders, sellers] = await Promise.all([
    readRows(env, "orders", "status,refund_status,payment_method,payment_verified_at,created_at", 1000, "created_at.desc"),
    readRows(env, "seller_profiles", "status", 1000, "created_at.desc")
  ]);
  return {
    orderStatuses: groupCount(orders, "status"),
    refundStatuses: groupCount(orders, "refund_status"),
    nonCodOrdersMissingPaymentVerificationTimestamp: orders.filter(row => !String(row.payment_method || "").toLowerCase().includes("cod") && row.payment_verified_at == null).length,
    sellerStatuses: groupCount(sellers, "status"),
    ordersReviewed: orders.length,
    sellersReviewed: sellers.length,
    mode: "risk_signals_for_human_review",
    note: "Missing timestamps and status counts are review signals only, not evidence of fraud or a basis for automatic action."
  };
}

export async function getBusinessOverview(env) {
  const [orders, products, sellers] = await Promise.all([
    readRows(env, "orders", "total_amount,currency,status,created_at,fulfillment_status", 1000, "created_at.desc"),
    readRows(env, "products", "is_active,category,price,rating", 1000, "updated_at.desc"),
    readRows(env, "seller_profiles", "status")
  ]);
  const grossPaidOrderValueByCurrency = {};
  for (const order of orders) {
    if (order.status !== "paid") continue;
    const currency = String(order.currency || "unknown");
    const amount = Number(order.total_amount);
    if (Number.isFinite(amount)) grossPaidOrderValueByCurrency[currency] = (grossPaidOrderValueByCurrency[currency] || 0) + amount;
  }
  return {
    orderStatuses: groupCount(orders, "status"),
    fulfillmentStatuses: groupCount(orders, "fulfillment_status"),
    grossPaidOrderValueByCurrency,
    productActiveStates: groupCount(products.map(row => ({ state: row.is_active ? "active" : "inactive" })), "state"),
    productCategories: groupCount(products, "category"),
    sellerStatuses: groupCount(sellers, "status"),
    rowsReviewed: { orders: orders.length, products: products.length, sellers: sellers.length },
    mode: "aggregate_read_only",
    note: "Gross paid order totals cover at most the latest 1000 rows and are not a full financial statement."
  };
}

export async function checkContentDuplicates(env, input = {}) {
  const captionHash = typeof input.caption_hash === "string" ? input.caption_hash.trim() : "";
  const imageHash = typeof input.image_hash === "string" ? input.image_hash.trim() : "";
  if ((!captionHash && !imageHash) || captionHash.length > 256 || imageHash.length > 256) {
    throw new Error("valid_caption_or_image_hash_required");
  }
  const rows = await readRows(env, "social_content_queue", "content_id,caption_hash,image_hash,scheduled_at", 1000);
  const captionMatch = captionHash ? rows.find(row => row.caption_hash === captionHash) : null;
  const imageMatch = imageHash ? rows.find(row => row.image_hash === imageHash) : null;
  return {
    duplicateCaption: Boolean(captionMatch),
    duplicateImage: Boolean(imageMatch),
    matchingContentIds: [...new Set([captionMatch?.content_id, imageMatch?.content_id].filter(Boolean))],
    recordsReviewed: rows.length,
    mode: "duplicate_check_only",
    note: "A clear result is limited to the first 1000 queued content records. This check does not publish or schedule anything."
  };
}

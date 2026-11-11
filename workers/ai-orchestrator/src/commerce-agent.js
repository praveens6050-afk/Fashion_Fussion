async function fetchSupabase(env, path, token) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error("commerce_not_configured");
  const response = await fetch(new URL(path, env.SUPABASE_URL), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token || env.SUPABASE_ANON_KEY}`,
      "content-type": "application/json"
    }
  });
  if (!response.ok) throw new Error(`supabase_http_${response.status}`);
  return response.status === 204 ? null : response.json();
}

export function buildProductRecommendations(rows = [], query = "") {
  const normalized = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const haystack = [row.name, row.category, row.description, row.badge].filter(Boolean).join(" ").toLowerCase();
    return !normalized || normalized.split(/\\s+/).every((word) => haystack.includes(word));
  });
  return {
    query: query.slice(0, 100),
    products: filtered.slice(0, 8).map((row) => ({
      id: row.id, name: row.name, category: row.category, price: row.price,
      currency: "INR", rating: row.rating, reviews: row.reviews,
      imageUrl: row.image_url, badge: row.badge, description: row.description,
      bulkAvailable: row.bulk_enabled, minimumBulkQuantity: row.bulk_min_qty
    })),
    mode: "catalog_read_only"
  };
}

export function buildOrderAssist(order) {
  const status = String(order.status || "").toLowerCase();
  const fulfillment = String(order.fulfillment_status || "").toLowerCase();
  const refund = String(order.refund_status || "").toLowerCase();
  const guidance = [];
  if (refund && !["none", "not_applicable", "not_requested"].includes(refund)) {
    guidance.push("A refund status is recorded. Check the latest confirmed update before sharing a completion estimate.");
  } else if (["cancelled", "canceled"].includes(status)) {
    guidance.push("The order is marked cancelled. Check the order record for any refund update.");
  } else if (["delivered", "complete", "completed"].includes(fulfillment)) {
    guidance.push("The order is marked delivered. Contact support if the parcel was not received.");
  } else if (["shipped", "in_transit", "out_for_delivery"].includes(fulfillment)) {
    guidance.push("The order is in the fulfilment process. Share a carrier tracking link only if one is available in the order system.");
  } else {
    guidance.push("The order is still being processed. The support team can confirm the next fulfilment update.");
  }
  return {
    order: {
      orderNumber: order.display_order_id,
      status: order.status,
      fulfillmentStatus: order.fulfillment_status,
      createdAt: order.created_at,
      fulfillmentUpdatedAt: order.fulfillment_updated_at,
      totalAmount: order.total_amount,
      currency: order.currency,
      paymentMethod: order.payment_method,
      refundStatus: order.refund_status,
      refundAmount: order.refund_amount,
      refundUpdatedAt: order.refund_updated_at
    },
    guidance,
    mode: "read_only",
    note: "This assistant cannot cancel orders, issue refunds, or alter payment or fulfilment records."
  };
}

export async function handleProductRecommendations(request, env, json) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (query.length < 2 && query.length !== 0) return json({ error: "query_too_short" }, 400);
  const params = new URLSearchParams({
    select: "id,name,category,price,rating,reviews,image_url,badge,description,bulk_enabled,bulk_min_qty",
    is_active: "eq.true",
    order: "rating.desc.nullslast,reviews.desc.nullslast",
    limit: "40"
  });
  try {
    const rows = await fetchSupabase(env, `/rest/v1/products?${params.toString()}`);
    return json({ recommendations: buildProductRecommendations(rows || [], query) }, 200);
  } catch {
    return json({ error: "product_catalog_unavailable" }, 502);
  }
}

export async function handleOrderAssist(request, env, json) {
  const auth = request.headers.get("Authorization") || "";
  const tokenMatch = auth.match(/^Bearer\\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "user_authentication_required" }, 401);
  const token = tokenMatch[1].trim();
  if (!token || token.length > 8192) return json({ error: "invalid_user_token" }, 401);
  let user;
  try {
    user = await fetchSupabase(env, "/auth/v1/user", token);
  } catch {
    return json({ error: "user_authentication_failed" }, 401);
  }
  if (!user?.id) return json({ error: "user_authentication_failed" }, 401);
  const orderNumber = decodeURIComponent(new URL(request.url).pathname.split("/").pop() || "").trim();
  if (!/^[A-Za-z0-9_-]{4,48}$/.test(orderNumber)) return json({ error: "invalid_order_number" }, 400);
  const params = new URLSearchParams({
    select: "display_order_id,status,total_amount,currency,created_at,fulfillment_status,fulfillment_updated_at,payment_method,refund_status,refund_amount,refund_updated_at",
    display_order_id: `eq.${orderNumber}`,
    limit: "1"
  });
  try {
    const rows = await fetchSupabase(env, `/rest/v1/orders?${params.toString()}`, token);
    if (!Array.isArray(rows) || !rows[0]) return json({ error: "order_not_found" }, 404);
    return json({ assist: buildOrderAssist(rows[0]) }, 200);
  } catch {
    return json({ error: "order_lookup_failed" }, 502);
  }
}

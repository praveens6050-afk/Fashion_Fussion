const ISSUE_RULES = [
  { category: "delivery", terms: ["delivery", "delivered", "shipping", "shipment", "courier", "tracking", "late", "dispatch"] },
  { category: "return_or_exchange", terms: ["return", "exchange", "replace", "replacement", "size issue", "wrong size"] },
  { category: "refund_or_payment", terms: ["refund", "payment", "paid", "payment failed", "charged", "razorpay", "upi"] },
  { category: "product_or_quality", terms: ["quality", "damaged", "defect", "broken", "fabric", "product", "wrong item"] },
  { category: "account_or_access", terms: ["login", "account", "otp", "password", "sign in", "verification"] }
];

export function classifySupportTicket(ticket, messages = []) {
  const text = [ticket?.issue_type, ticket?.subject, ...messages.map((item) => item.message)]
    .filter(Boolean).join(" ").toLowerCase();
  const match = ISSUE_RULES.find((rule) => rule.terms.some((term) => text.includes(term)));
  const category = match?.category || "general";
  const urgent = /fraud|unauthori[sz]ed|wrong person|safety|legal|chargeback|threat/i.test(text);
  return {
    category,
    priority: urgent ? "urgent_review" : (ticket?.priority || "normal"),
    requiresHumanReview: urgent || ["refund_or_payment", "return_or_exchange"].includes(category),
    suggestedNextSteps: nextSteps(category, urgent)
  };
}

function nextSteps(category, urgent) {
  if (urgent) return ["Pause automated replies", "Route to an authorized human reviewer", "Preserve the ticket and relevant audit history"];
  const steps = {
    delivery: ["Check the latest carrier scan in the order system", "Share only the verified tracking update", "Escalate if the carrier scan is stale"],
    return_or_exchange: ["Check the order's return window and item eligibility", "Confirm the requested size or replacement option", "Ask an authorized agent to approve the return or exchange"],
    refund_or_payment: ["Verify payment and refund state from the payment record", "Do not promise a refund date before provider confirmation", "Route any refund action for human approval"],
    product_or_quality: ["Request clear photos if needed", "Check the listing and seller quality record", "Route a confirmed defect through the existing return policy"],
    account_or_access: ["Use the existing account recovery flow", "Never ask the customer to share an OTP or password"],
    general: ["Review the full ticket history", "Ask one focused clarification if required", "Escalate unresolved cases to customer care"]
  };
  return steps[category] || steps.general;
}

export function buildSupportAssistResponse(ticket, messages = []) {
  const triage = classifySupportTicket(ticket, messages);
  const replyByCategory = {
    delivery: "Thanks for contacting Fashion Fussion. We’re checking the latest delivery update for your order. We’ll share only the confirmed tracking information as soon as it is available.",
    return_or_exchange: "Thanks for reaching out. We can help check the return or exchange options for your item. Our team will verify the order and eligibility before confirming the next step.",
    refund_or_payment: "Thanks for letting us know. Our team will verify the payment and refund status against the payment record. We’ll confirm the next step after that check.",
    product_or_quality: "We’re sorry about the issue with your item. Please share clear photos of the product and packaging, if available, so our team can review it and guide you through the applicable policy.",
    account_or_access: "We can help you regain access to your account. Please use the account recovery option in Fashion Fussion; never share your OTP or password with anyone.",
    general: "Thanks for contacting Fashion Fussion. We’ve received your message and our support team will review it. If anything important is missing, we’ll ask you for the specific details needed."
  };
  return {
    ticket: {
      ticketCode: ticket.ticket_code,
      subject: ticket.subject,
      status: ticket.status,
      channel: ticket.channel,
      createdAt: ticket.created_at
    },
    triage,
    suggestedReply: replyByCategory[triage.category],
    mode: "draft_only"
  };
}

async function supabaseFetch(env, path, token) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error("support_auth_not_configured");
  const response = await fetch(new URL(path, env.SUPABASE_URL), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    }
  });
  if (!response.ok) throw new Error(`supabase_http_${response.status}`);
  return response.status === 204 ? null : response.json();
}

export async function handleSupportAssist(request, env, json) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "user_authentication_required" }, 401);
  const token = match[1].trim();
  if (!token || token.length > 8192) return json({ error: "invalid_user_token" }, 401);

  let user;
  try {
    user = await supabaseFetch(env, "/auth/v1/user", token);
  } catch {
    return json({ error: "user_authentication_failed" }, 401);
  }
  if (!user?.id) return json({ error: "user_authentication_failed" }, 401);

  const ticketCode = decodeURIComponent(new URL(request.url).pathname.split("/").at(-2) || "").trim();
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(ticketCode)) return json({ error: "invalid_ticket_code" }, 400);

  const ticketQuery = new URLSearchParams({
    select: "id,ticket_code,channel,issue_type,subject,status,priority,created_at",
    ticket_code: `eq.${ticketCode}`,
    limit: "1"
  });
  let tickets;
  try {
    tickets = await supabaseFetch(env, `/rest/v1/support_tickets?${ticketQuery.toString()}`, token);
  } catch {
    return json({ error: "ticket_lookup_failed" }, 502);
  }
  if (!Array.isArray(tickets) || !tickets[0]) return json({ error: "ticket_not_found" }, 404);

  const ticket = tickets[0];
  const messageQuery = new URLSearchParams({
    select: "sender_role,message,created_at",
    ticket_id: `eq.${ticket.id}`,
    order: "created_at.desc",
    limit: "10"
  });
  let messages = [];
  try {
    messages = await supabaseFetch(env, `/rest/v1/support_ticket_messages?${messageQuery.toString()}`, token) || [];
  } catch {
    return json({ error: "ticket_history_lookup_failed" }, 502);
  }
  return json({ assist: buildSupportAssistResponse(ticket, messages) }, 200);
}

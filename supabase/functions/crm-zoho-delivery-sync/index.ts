import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://www.crm.fashionfussion.in", "https://crm.fashionfussion.in"]);
const headers = (origin: string | null) => ({
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: headers(origin) });
const address = (value: unknown) => String(value || "").trim().toLowerCase();

function deliveryState(value: unknown): "queued" | "delivered" | "failed" | null {
  const status = String(value || "").trim().toLowerCase();
  if (/deliver(ed|y success)|mail delivered/.test(status)) return "delivered";
  if (/fail|bounce|reject|undeliver|invalid recipient/.test(status)) return "failed";
  if (/queue|retry|progress|moderated|processing/.test(status)) return "queued";
  return null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, null);
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const clientId = Deno.env.get("ZOHO_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET") || "";
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) return json({ error: "ZOHO_OAUTH_SETUP_INCOMPLETE" }, 503, origin);
  const accessToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!accessToken) return json({ error: "AUTH_REQUIRED" }, 401, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) return json({ error: "INVALID_SESSION" }, 401, origin);
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (profile?.is_admin !== true) return json({ error: "ADMINISTRATOR_REQUIRED" }, 403, origin);

  try {
    const { data: mailbox, error: mailboxError } = await db.rpc("crm_get_zoho_mailbox_auth", { p_department: "customer_support" });
    if (mailboxError || !mailbox?.refresh_token || !mailbox?.zoho_account_id) return json({ error: "ZOHO_MAILBOX_NOT_CONNECTED" }, 409, origin);
    const accountsDomain = (Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") || "https://accounts.zoho.in").replace(/\/+$/, "");
    const refresh = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: String(mailbox.refresh_token) });
    const tokenResponse = await fetch(accountsDomain + "/oauth/v2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: refresh, redirect: "error" });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload?.access_token) return json({ error: "ZOHO_TOKEN_REFRESH_FAILED" }, 502, origin);

    const apiBase = (Deno.env.get("ZOHO_MAIL_API_BASE") || "https://mail.zoho.in/api").replace(/\/+$/, "");
    const authHeaders = { authorization: "Zoho-oauthtoken " + String(tokenPayload.access_token), accept: "application/json" };
    const accountResponse = await fetch(apiBase + "/accounts/" + encodeURIComponent(String(mailbox.zoho_account_id)), { headers: authHeaders, redirect: "error" });
    const accountPayload = await accountResponse.json().catch(() => ({}));
    if (!accountResponse.ok || String(accountPayload?.status?.code || "200") !== "200") return json({ error: "ZOHO_ACCOUNT_LOOKUP_FAILED" }, 502, origin);
    const zoid = String(accountPayload?.data?.zoid || accountPayload?.data?.account?.zoid || "");
    if (!/^\d+$/.test(zoid)) return json({ error: "ZOHO_ORGANIZATION_ID_MISSING" }, 502, origin);

    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const { data: messages, error: messagesError } = await db.from("crm_inbox_messages")
      .select("id,conversation_id,provider_message_id,received_at,delivery_status,metadata")
      .eq("direction", "outbound").gte("received_at", new Date(cutoff).toISOString())
      .in("delivery_status", ["sent", "queued"]).order("received_at", { ascending: false }).limit(200);
    if (messagesError) throw new Error("CRM_OUTBOX_LOOKUP_FAILED");
    const outbound = (messages || []).filter((message: any) => message?.metadata?.provider === "email");
    if (!outbound.length) return json({ ok: true, checked: 0, updated: 0, failed: 0, reason: "NO_RECENT_EMAILS" }, 200, origin);
    const conversationIds = [...new Set(outbound.map((item: any) => Number(item.conversation_id)).filter(Number.isSafeInteger))];
    const { data: conversations, error: conversationsError } = await db.from("crm_inbox_conversations")
      .select("id,contact_email,department,inbox_address").in("id", conversationIds);
    if (conversationsError) throw new Error("CRM_OUTBOX_LOOKUP_FAILED");
    const byId = new Map((conversations || []).map((item: any) => [Number(item.id), item]));
    const pending = outbound.map((message: any) => ({ message, conversation: byId.get(Number(message.conversation_id)) }))
      .filter((item: any) => item.conversation?.contact_email && item.message.received_at);
    const minSent = pending.reduce((min: number, item: any) => Math.min(min, Date.parse(item.message.received_at)), Date.now());
    const fromAddresses = [...new Set(pending.map((item: any) => address(item.message.metadata?.from_address || item.conversation.inbox_address)).filter(Boolean))];
    const now = Date.now();
    const logs: any[] = [];
    for (const fromAddress of fromAddresses) {
      let nextPage = false;
      let pageKey = "false";
      for (let page = 0; page < 5; page++) {
        const body = {
          fromDateTime: Math.max(cutoff, minSent - 15 * 60 * 1000), toDateTime: now,
          searchCriteria: "fromAddr", searchKey: fromAddress, limit: 500,
          isNext: nextPage, isPrevious: false, pageKey, prevKey: "false", isReverseSearch: false,
        };
        const logResponse = await fetch(apiBase + "/organization/" + encodeURIComponent(zoid) + "/smtplogs", {
          method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error",
        });
        const logPayload = await logResponse.json().catch(() => ({}));
        if (logResponse.status === 401 || logResponse.status === 403 || String(logPayload?.status?.code || "") === "403") {
          return json({ ok: false, error: "ZOHO_DELIVERY_SCOPE_REQUIRED" }, 200, origin);
        }
        if (!logResponse.ok || String(logPayload?.status?.code || "200") !== "200") return json({ error: "ZOHO_DELIVERY_LOGS_FAILED" }, 502, origin);
        const logData = logPayload?.data;
        const items = logData?.response;
        if (Array.isArray(items)) logs.push(...items);
        const nextKey = String(logData?.pagekey || "");
        if (String(logData?.hnxt || "").toLowerCase() !== "true" || !nextKey) break;
        nextPage = true;
        pageKey = nextKey;
      }
    }

    let updated = 0;
    let failed = 0;
    const consumedRecipients = new Set<string>();
    for (const item of pending) {
      const sentAt = Date.parse(item.message.received_at);
      const to = address(item.conversation.contact_email);
      let best: { recipient: any; sentTime: number; delta: number } | null = null;
      for (const log of logs) {
        const from = address(log?.from?.from || log?.from?.sender);
        const expectedFrom = address(item.message.metadata?.from_address || item.conversation.inbox_address);
        if (from && from !== expectedFrom) continue;
        const sentTime = Number(log?.from?.sentTimeMillis || 0);
        if (!sentTime) continue;
        for (const recipient of Array.isArray(log?.recipients) ? log.recipients : []) {
          if (address(recipient?.rcpt) !== to) continue;
          const receiptKey = [log?.TransactionID || log?.transactionId || log?.from?.msgId || sentTime, to, recipient?.timeMillis || ""].join(":");
          if (consumedRecipients.has(receiptKey)) continue;
          const delta = Math.abs(sentTime - sentAt);
          if (delta > 15 * 60 * 1000) continue;
          if (!best || delta < best.delta) best = { recipient: { ...recipient, _trackingKey: receiptKey }, sentTime, delta };
        }
      }
      if (!best) continue;
      consumedRecipients.add(String(best.recipient?._trackingKey || ""));
      const rawStatus = best.recipient?.deliveryStatus || best.recipient?.deliveryStatus_i18n || "";
      const state = deliveryState(rawStatus);
      if (!state) continue;
      const tracking = {
        provider: "zoho-smtp-logs", recipient: to, provider_status: String(rawStatus).slice(0, 120),
        recipient_time: best.recipient?.timeMillis ? new Date(Number(best.recipient.timeMillis)).toISOString() : null,
        checked_at: new Date().toISOString(),
      };
      const metadata = { ...(item.message.metadata || {}), delivery_tracking: tracking };
      const { error } = await db.from("crm_inbox_messages").update({ delivery_status: state, metadata }).eq("id", item.message.id);
      if (error) failed++; else updated++;
    }
    return json({ ok: failed === 0, checked: pending.length, updated, not_yet_reported: Math.max(0, pending.length - updated - failed), failed }, 200, origin);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ZOHO_DELIVERY_SYNC_FAILED";
    console.error("[CRM Zoho delivery sync] Failed:", code);
    return json({ error: code.startsWith("CRM_") || code.startsWith("ZOHO_") ? code : "ZOHO_DELIVERY_SYNC_FAILED" }, 502, origin);
  }
});


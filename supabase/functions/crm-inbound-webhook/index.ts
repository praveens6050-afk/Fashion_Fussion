// Unified inbound CRM webhook. Deploy only after secrets and provider webhook setup are approved.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-hub-signature-256,x-ff-inbox-signature", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function getMessageBody(m: any): string {
  if (m?.text?.body) return String(m.text.body);
  if (m?.button?.text) return String(m.button.text);
  if (m?.interactive?.button_reply?.title) return String(m.interactive.button_reply.title);
  if (m?.interactive?.list_reply?.title) return String(m.interactive.list_reply.title);
  if (m?.image?.caption) return String(m.image.caption);
  if (m?.document?.caption) return String(m.document.caption);
  if (m?.type) return "[Incoming " + String(m.type) + " message; open the WhatsApp Business inbox to view the attachment]";
  return "";
}
function routeForBusinessNumber(id: string) {
  if (id && id === Deno.env.get("WHATSAPP_SALES_PHONE_NUMBER_ID")) return "sales";
  if (id && id === Deno.env.get("WHATSAPP_MARKETING_PHONE_NUMBER_ID")) return "marketing";
  return "support"; // seller/customer is resolved securely by the database from verified sender phone
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && challenge && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return json({ error: "Webhook verification failed" }, 403);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Webhook is not configured" }, 503);
  const raw = await req.text();
  if (raw.length > 1_000_000) return json({ error: "Payload too large" }, 413);
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
  const isWhatsApp = Array.isArray(payload?.entry);
  if (isWhatsApp) {
    const secret = Deno.env.get("META_APP_SECRET");
    const signature = req.headers.get("x-hub-signature-256") || "";
    if (!secret || !signature.startsWith("sha256=")) return json({ error: "WhatsApp signature configuration missing" }, 401);
    const expected = "sha256=" + await hmac(secret, raw);
    if (!safeEqual(signature, expected)) return json({ error: "Invalid WhatsApp signature" }, 401);
  } else {
    const secret = Deno.env.get("CRM_EMAIL_WEBHOOK_SECRET");
    const signature = (req.headers.get("x-ff-inbox-signature") || "").replace(/^sha256=/, "");
    if (!secret || !signature || !safeEqual(signature, await hmac(secret, raw))) return json({ error: "Invalid email webhook signature" }, 401);
  }
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let stored = 0;
  try {
    if (isWhatsApp) {
      for (const entry of payload.entry || []) for (const change of entry.changes || []) {
        const value = change.value || {};
        const businessId = String(value.metadata?.phone_number_id || "");
        const route = routeForBusinessNumber(businessId);
        // Meta sends delivery receipts in the same signed webhook as inbound messages.
        // Match by the provider message ID; never accept a status for an unrelated row.
        for (const receipt of value.statuses || []) {
          const providerMessageId = String(receipt.id || "");
          const deliveryStatus = String(receipt.status || "").toLowerCase();
          if (!providerMessageId || !["sent", "delivered", "read", "failed"].includes(deliveryStatus)) continue;
          const { data: prior, error: lookupError } = await db.from("crm_inbox_messages")
            .select("id,metadata,send_request_id")
            .eq("provider_message_id", providerMessageId)
            .eq("direction", "outbound")
            .maybeSingle();
          if (lookupError) throw lookupError;
          if (!prior) continue;
          const receiptErrors = Array.isArray(receipt.errors)
            ? receipt.errors.map((e: any) => ({ code: e.code ?? null, title: e.title ?? null })).slice(0, 3)
            : [];
          const { error: updateError } = await db.from("crm_inbox_messages")
            .update({
              delivery_status: deliveryStatus,
              metadata: {
                ...(prior.metadata && typeof prior.metadata === "object" ? prior.metadata : {}),
                meta_delivery_status: deliveryStatus,
                meta_status_timestamp: receipt.timestamp ? String(receipt.timestamp) : null,
                meta_status_errors: receiptErrors
              }
            })
            .eq("id", prior.id);
          if (updateError) throw updateError;
          if (deliveryStatus === "failed" && prior.send_request_id) {
            const code = receiptErrors[0]?.code;
            const { error: attemptError } = await db.from("crm_inbox_send_attempts")
              .update({ state: "failed", error_code: code ? "META_" + String(code) : "META_DELIVERY_FAILED", updated_at: new Date().toISOString() })
              .eq("request_id", prior.send_request_id);
            if (attemptError) throw attemptError;
          }
          stored++;
        }
        const contacts = new Map((value.contacts || []).map((c: any) => [String(c.wa_id || ""), c]));
        for (const m of value.messages || []) {
          const sender = String(m.from || "");
          const contact: any = contacts.get(sender) || {};
          const body = getMessageBody(m).slice(0, 10000);
          if (!m.id || !sender || !body) continue;
          const metadata: Record<string, unknown> = { message_type: m.type || "unknown", business_phone_number_id: businessId, display_phone_number: value.metadata?.display_phone_number || null };
          if (route === "sales" || route === "marketing") metadata.route_department = route;
          const { error } = await db.rpc("crm_ingest_inbound_message", {
            p_provider: "whatsapp", p_provider_message_id: String(m.id), p_sender_phone: sender,
            p_sender_email: null, p_sender_name: String(contact.profile?.name || ""),
            p_inbox_address: String(value.metadata?.display_phone_number || ""), p_subject: "WhatsApp message",
            p_body: body, p_provider_thread_id: sender, p_metadata: metadata
          });
          if (error) throw error;
          stored++;
        }
      }
    } else {
      // Email provider adapter contract: signed Zoho Flow/webhook payload normalized to
      // { messages: [{ id, from_email, from_name, from_phone, to, subject, text, thread_id }] }.
      const messages = Array.isArray(payload.messages) ? payload.messages : [payload];
      for (const m of messages) {
        // Accept the documented normalized Zoho bridge payload and common provider aliases.
        const id = String(m.id || m.message_id || m.externalMessageId || m.external_message_id || "");
        const body = String(m.text || m.body || m.text_body || m.textBody || "");
        const senderRaw = String(m.from_email || m.fromEmail || m.from || "");
        const senderMatch = senderRaw.match(/<([^<>]+)>/);
        const senderEmail = (senderMatch ? senderMatch[1] : senderRaw).trim().toLowerCase();
        const senderName = String(m.from_name || m.fromName || (senderMatch ? senderRaw.replace(senderMatch[0], "").replace(/["']/g, "").trim() : ""));
        const toRaw = m.to || m.inbox_address || m.recipient || "";
        const recipients = (Array.isArray(toRaw) ? toRaw : String(toRaw).split(/[;,]/))
          .map((value: any) => String(value?.email || value?.address || value || "").trim())
          .map((value: string) => {
            const match = value.match(/<([^<>]+)>/);
            return (match ? match[1] : value).trim().toLowerCase();
          }).filter(Boolean);
        // Orders are handled by the dedicated order-notification workflow, never the support CRM.
        const crmRecipients = recipients.filter((address: string) =>
          ["customer.care@fashionfussion.in", "seller.support@fashionfussion.in", "seller-support@fashionfussion.in", "orders@fashionfussion.in", "sales.team@fashionfussion.in", "sales@fashionfussion.in", "marketing@fashionfussion.in", "campaigns@fashionfussion.in"].includes(address)
        );
        if (!id || !body.trim() || !senderEmail.includes("@") || !crmRecipients.length) continue;
        const inboxAddress = crmRecipients[0];
        const internalZohoId = m.zoho_message_id || m.zohoMessageId || m.zohoInternalMessageId || null;
        const { error } = await db.rpc("crm_ingest_inbound_message", {
          p_provider: "email", p_provider_message_id: id,
          p_sender_phone: m.from_phone || m.fromPhone ? String(m.from_phone || m.fromPhone) : null,
          p_sender_email: senderEmail, p_sender_name: senderName,
          p_inbox_address: inboxAddress,
          p_subject: String(m.subject || "Incoming email").slice(0, 500),
          p_body: body.slice(0, 10000),
          p_provider_thread_id: m.thread_id || m.threadId ? String(m.thread_id || m.threadId) : null,
          p_metadata: {
            provider: String(m.provider || "zoho-flow"),
            zoho_message_id: internalZohoId ? String(internalZohoId) : null,
            external_message_id: id,
            received_at: m.receivedAt || m.received_at || null,
            headers: m.headers && typeof m.headers === "object" ? {
              message_id: m.headers.message_id || null,
              in_reply_to: m.headers.in_reply_to || null
            } : {}
          }
        });
        if (error) throw error;
        stored++;
      }
    }
    return json({ ok: true, stored });
  } catch (error) {
    console.error("CRM inbox ingest failed", error);
    return json({ error: "Inbound event could not be stored" }, 500);
  }
});

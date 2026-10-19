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
        const id = String(m.id || m.message_id || "");
        const body = String(m.text || m.body || m.text_body || "").slice(0, 10000);
        if (!id || !body || !m.from_email) continue;
        const { error } = await db.rpc("crm_ingest_inbound_message", {
          p_provider: "email", p_provider_message_id: id,
          p_sender_phone: m.from_phone ? String(m.from_phone) : null,
          p_sender_email: String(m.from_email), p_sender_name: String(m.from_name || ""),
          p_inbox_address: String(m.to || m.inbox_address || ""), p_subject: String(m.subject || "Incoming email").slice(0, 500),
          p_body: body, p_provider_thread_id: m.thread_id ? String(m.thread_id) : null,
          p_metadata: { provider: String(m.provider || "zoho-flow"), zoho_message_id: m.zoho_message_id || m.zohoMessageId || m.messageId || null, headers: m.headers && typeof m.headers === "object" ? { message_id: m.headers.message_id || null, in_reply_to: m.headers.in_reply_to || null } : {} }
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

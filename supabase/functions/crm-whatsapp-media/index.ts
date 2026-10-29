import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED = new Set([
  "image/jpeg", "image/png", "application/pdf", "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const MAX_BYTES = 15 * 1024 * 1024;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" }
});
const safeFilename = (value: unknown) => {
  const name = String(value || "whatsapp-attachment").replace(/[\\/\0-\x1f\x7f]/g, "_").slice(0, 180);
  return name || "whatsapp-attachment";
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return json({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const waToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") || Deno.env.get("WHATSAPP_CLOUD_API_TOKEN");
  if (!url || !anonKey || !serviceKey || !waToken) return json({ error: "Attachment service is not configured" }, 503);

  let input: any;
  try { input = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const providerMessageId = typeof input?.provider_message_id === "string" ? input.provider_message_id.trim() : "";
  if (!providerMessageId || providerMessageId.length > 300) return json({ error: "A valid provider message ID is required" }, 400);

  // First query with the caller's JWT so Supabase RLS remains the authorization boundary.
  const userDb = createClient(url, anonKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: authError } = await userDb.auth.getUser(token);
  if (authError || !userData?.user) return json({ error: "Session is invalid or expired" }, 401);

  const { data: message, error: messageError } = await userDb.from("crm_inbox_messages")
    .select("provider_message_id,provider,metadata")
    .eq("provider_message_id", providerMessageId)
    .eq("provider", "whatsapp")
    .maybeSingle();
  if (messageError || !message) return json({ error: "Attachment not found or access denied" }, 404);

  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, any> : {};
  const attachment = metadata.whatsapp_attachment && typeof metadata.whatsapp_attachment === "object"
    ? metadata.whatsapp_attachment as Record<string, any> : null;
  if (!attachment?.media_id) return json({ error: "This message has no stored media reference. Ask the customer to resend the attachment." }, 404);
  const mime = String(attachment.mime_type || "").toLowerCase().split(";")[0];
  if (!attachment.supported || !ALLOWED.has(mime)) return json({ error: "This attachment type is not supported", mime_type: mime || null }, 415);

  const graphVersion = (Deno.env.get("META_GRAPH_API_VERSION") || "v22.0").replace(/[^v0-9.]/g, "");
  let mediaInfo: any;
  try {
    const infoResponse = await fetch("https://graph.facebook.com/" + graphVersion + "/" + encodeURIComponent(String(attachment.media_id)), {
      headers: { Authorization: "Bearer " + waToken },
      signal: AbortSignal.timeout(15000)
    });
    if (!infoResponse.ok) return json({ error: "Meta media lookup failed", provider_status: infoResponse.status }, 502);
    mediaInfo = await infoResponse.json();
  } catch {
    return json({ error: "Meta media lookup timed out or failed" }, 502);
  }
  const mediaUrl = typeof mediaInfo?.url === "string" ? mediaInfo.url : "";
  let parsedUrl: URL;
  try { parsedUrl = new URL(mediaUrl); } catch { return json({ error: "Meta returned an invalid media URL" }, 502); }
  const hostAllowed = parsedUrl.protocol === "https:" && (
    parsedUrl.hostname === "graph.facebook.com" ||
    parsedUrl.hostname.endsWith(".fbcdn.net") ||
    parsedUrl.hostname === "fbcdn.net" ||
    parsedUrl.hostname.endsWith(".fbsbx.com") ||
    parsedUrl.hostname === "fbsbx.com"
  );
  if (!hostAllowed) return json({ error: "Meta returned an unexpected media host" }, 502);

  let fileResponse: Response;
  try {
    fileResponse = await fetch(parsedUrl, {
      headers: { Authorization: "Bearer " + waToken },
      signal: AbortSignal.timeout(25000)
    });
  } catch {
    return json({ error: "Meta media download failed" }, 502);
  }
  if (!fileResponse.ok) return json({ error: "Meta media download failed", provider_status: fileResponse.status }, 502);
  const actualMime = String(fileResponse.headers.get("content-type") || mime).split(";")[0].trim().toLowerCase();
  if (!ALLOWED.has(actualMime) || (actualMime !== mime && !(mime === "image/jpeg" && actualMime === "application/octet-stream"))) {
    return json({ error: "Downloaded media MIME type did not match the approved attachment type" }, 415);
  }
  const declaredLength = Number(fileResponse.headers.get("content-length") || 0);
  if (declaredLength > MAX_BYTES) return json({ error: "Attachment exceeds the 15 MB CRM preview limit" }, 413);
  const bytes = await fileResponse.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return json({ error: "Attachment exceeds the 15 MB CRM preview limit" }, 413);

  const filename = safeFilename(attachment.filename || (mime === "application/pdf" ? "attachment.pdf" : "whatsapp-attachment"));
  return new Response(bytes, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
      "X-Content-Type-Options": "nosniff"
    }
  });
});

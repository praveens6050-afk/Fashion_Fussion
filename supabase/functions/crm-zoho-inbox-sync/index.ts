import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://www.crm.fashionfussion.in",
  "https://crm.fashionfussion.in",
]);
const baseHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function headers(origin: string | null) {
  return {
    ...baseHeaders,
    ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}
function accountsDomain(): string {
  const value = (Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") || "https://accounts.zoho.in").replace(/\/+$/g, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !/^accounts\.zoho\.(in|com|eu|com\.au|jp|ca|sa|uk)$/.test(parsed.hostname)) {
    throw new Error("ZOHO_ACCOUNTS_DOMAIN_INVALID");
  }
  return value;
}
function decodeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;|&#160;/gi, " ");
}
function plainText(html: unknown): string {
  return decodeHtml(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim()
    .slice(0, 10000);
}
function addresses(value: unknown): string[] {
  const text = decodeHtml(value);
  return [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0].toLowerCase());
}
function receivedIso(value: unknown): string | null {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function attachmentMime(name: unknown): string {
  const ext = String(name || "").toLowerCase().split(".").pop() || "";
  const types: Record<string,string> = { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif", webp:"image/webp", pdf:"application/pdf" };
  return types[ext] || "";
}
async function zohoAttachments(apiBase: string, accountId: string, folderId: string, messageId: string, token: string) {
  const url = apiBase + "/accounts/" + accountId + "/folders/" + encodeURIComponent(folderId) +
    "/messages/" + encodeURIComponent(messageId) + "/attachmentinfo?includeInline=true";
  const data = await zohoRequest(url, token);
  const files = [...(Array.isArray(data?.attachments) ? data.attachments : []),
    ...(Array.isArray(data?.inline) ? data.inline : [])];
  return files.slice(0,10).flatMap((file: any) => {
    const filename = String(file?.attachmentName || "").slice(0,180);
    const mime = attachmentMime(filename);
    const id = String(file?.attachmentId || "");
    const size = Number(file?.attachmentSize || 0);
    if (!id || !mime || size > 15 * 1024 * 1024) return [];
    return [{ attachment_id:id, filename, mime_type:mime, size, supported:true,
      inline:!!file?.cid }];
  });
}
async function zohoRequest(url: string, accessToken: string): Promise<any> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "authorization": "Zoho-oauthtoken " + accessToken, "accept": "application/json" },
    redirect: "error",
  });
  const payload = await response.json().catch(() => ({}));
  const code = String(payload?.status?.code ?? "");
  if (!response.ok || (code && code !== "200")) {
    throw new Error("ZOHO_MAIL_API_FAILED");
  }
  return payload?.data;
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
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    return json({ error: "ZOHO_OAUTH_SETUP_INCOMPLETE" }, 503, origin);
  }
  const bearer = req.headers.get("authorization") || "";
  const accessToken = bearer.replace(/^Bearer\s+/i, "");
  if (!accessToken) return json({ error: "AUTH_REQUIRED" }, 401, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) return json({ error: "INVALID_SESSION" }, 401, origin);
  const { data: profile, error: profileError } = await db.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (profileError || profile?.is_admin !== true) return json({ error: "ADMINISTRATOR_REQUIRED" }, 403, origin);

  try {
    const { data: mailbox, error: mailboxError } = await db.rpc("crm_get_zoho_mailbox_auth", { p_department: "customer_support" });
    if (mailboxError || !mailbox?.refresh_token || !mailbox?.zoho_account_id) {
      return json({ error: "ZOHO_MAILBOX_NOT_CONNECTED" }, 409, origin);
    }
    const authDomain = accountsDomain();
    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: String(mailbox.refresh_token),
    });
    const tokenResponse = await fetch(authDomain + "/oauth/v2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: refreshBody,
      redirect: "error",
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload?.access_token) return json({ error: "ZOHO_TOKEN_REFRESH_FAILED" }, 502, origin);

    const apiBase = (Deno.env.get("ZOHO_MAIL_API_BASE") || "https://mail.zoho.in/api").replace(/\/+$/g, "");
    const accountId = encodeURIComponent(String(mailbox.zoho_account_id));
    const folderData = await zohoRequest(apiBase + "/accounts/" + accountId + "/folders", String(tokenPayload.access_token));
    const folders = Array.isArray(folderData) ? folderData : Array.isArray(folderData?.folders) ? folderData.folders : [];
    const inbox = folders.find((folder: any) => String(folder?.folderType || "").toLowerCase() === "inbox")
      || folders.find((folder: any) => String(folder?.folderName || "").toLowerCase() === "inbox");
    const folderId = String(inbox?.folderId || "");
    if (!folderId) return json({ error: "ZOHO_INBOX_FOLDER_NOT_FOUND" }, 502, origin);

    const query = new URLSearchParams({ folderId, start: "1", limit: "100", status: "all", sortBy: "date", sortorder: "false", includeto: "true", includesent: "false" });
    const messageData = await zohoRequest(apiBase + "/accounts/" + accountId + "/messages/view?" + query.toString(), String(tokenPayload.access_token));
    const listedMessages = Array.isArray(messageData) ? messageData : Array.isArray(messageData?.data) ? messageData.data : [];
    const aliases = new Set([
      "admin@fashionfussion.in",
      "customer.care@fashionfussion.in",
      "seller.support@fashionfussion.in",
      "seller-support@fashionfussion.in",
      "sales@fashionfussion.in",
      "sales.team@fashionfussion.in",
      "marketing@fashionfussion.in",
      "orders@fashionfussion.in",
    ]);
    const candidates = listedMessages.map((message: any) => {
      const recipients = [...addresses(message?.toAddress), ...addresses(message?.ccAddress)];
      const inboxAddress = recipients.find((address) => aliases.has(address));
      const messageId = String(message?.messageId || "");
      return { message, messageId, inboxAddress };
    }).filter((item: any) => item.messageId && item.inboxAddress);
    const ids = candidates.map((item: any) => item.messageId);
    const { data: known, error: knownError } = ids.length
      ? await db.from("crm_inbox_messages").select("provider_message_id,metadata").eq("direction", "inbound").in("provider_message_id", ids)
      : { data: [], error: null };
    if (knownError) throw new Error("CRM_INBOX_LOOKUP_FAILED");
    const knownById = new Map((known || []).map((item: any) => [String(item.provider_message_id),item]));
    const knownIds = new Set(knownById.keys());
    const unseen = candidates.filter((item: any) => !knownIds.has(item.messageId));
    const deferred = Math.max(0, unseen.length - 25);
    const pending = unseen.slice(0, 25).reverse();
    const attachmentBackfill = candidates.filter((item: any) => {
      const previous:any=knownById.get(item.messageId);
      return previous && String(item.message?.hasAttachment || "0")==="1"
        && !Array.isArray(previous.metadata?.zoho_attachments);
    }).slice(0,25);
    let imported = 0;
    let attachmentsUpdated = 0;
    let skipped = listedMessages.length - candidates.length;
    for (const item of pending) {
      const message = item.message;
      const folder = encodeURIComponent(String(message?.folderId || folderId));
      const messageId = encodeURIComponent(item.messageId);
      const contentData = await zohoRequest(apiBase + "/accounts/" + accountId + "/folders/" + folder + "/messages/" + messageId + "/content?includeBlockContent=false", String(tokenPayload.access_token));
      const body = plainText(contentData?.content || message?.summary || "");
      const safeBody = body || (String(message?.hasAttachment || "0") === "1" ? "[Email contains an attachment; open the attachment in Zoho Mail.]" : "[Email has no text content.]" );
      const senderEmail = addresses(message?.fromAddress)[0] || "";
      const senderName = decodeHtml(message?.sender || senderEmail).slice(0, 200);
      const threadId = String(message?.threadId || item.messageId);
      const receivedAt = receivedIso(message?.receivedTime);
      let zohoAttachmentList:any[]=[];
      let attachmentPending=false;
      if (String(message?.hasAttachment || "0")==="1") {
        try { zohoAttachmentList=await zohoAttachments(apiBase,accountId,String(message?.folderId||folderId),item.messageId,String(tokenPayload.access_token)); }
        catch(error) { attachmentPending=true;console.warn("[CRM Zoho attachments] Metadata lookup deferred:",error instanceof Error?error.message:"unknown"); }
      }
      const { data: conversationId, error: ingestError } = await db.rpc("crm_ingest_inbound_message", {
        p_provider: "email",
        p_provider_message_id: item.messageId,
        p_sender_phone: null,
        p_sender_email: senderEmail || null,
        p_sender_name: senderName,
        p_inbox_address: item.inboxAddress,
        p_subject: decodeHtml(message?.subject || "Incoming email").slice(0, 500),
        p_body: safeBody,
        p_provider_thread_id: threadId,
        p_metadata: {
          provider: "zoho-mail-api",
          zoho_message_id: item.messageId,
          zoho_folder_id: folderId,
          received_at: receivedAt,
          received_time: message?.receivedTime ? String(message.receivedTime) : null,
          ...(String(message?.hasAttachment || "0")==="1" ? { zoho_attachments:zohoAttachmentList, zoho_attachments_pending:attachmentPending } : {}),
        },
      });
      if (ingestError) throw new Error("CRM_EMAIL_INGEST_FAILED");
      if (receivedAt && conversationId) {
        await db.from("crm_inbox_conversations").update({ received_at: receivedAt }).eq("id", conversationId);
        await db.from("crm_inbox_messages").update({ received_at: receivedAt }).eq("provider_message_id", item.messageId).eq("direction", "inbound");
      }
      imported++;
    }
    for (const item of attachmentBackfill) {
      const previous:any=knownById.get(item.messageId);
      try {
        const attachments=await zohoAttachments(apiBase,accountId,String(item.message?.folderId||folderId),item.messageId,String(tokenPayload.access_token));
        const { error:updateError }=await db.from("crm_inbox_messages").update({metadata:{
          ...(previous.metadata&&typeof previous.metadata==="object"?previous.metadata:{}),
          zoho_attachments:attachments,zoho_attachments_pending:false
        }}).eq("provider_message_id",item.messageId).eq("direction","inbound");
        if(updateError)throw new Error("CRM_EMAIL_ATTACHMENT_METADATA_UPDATE_FAILED");
        attachmentsUpdated++;
      } catch(error) {
        console.warn("[CRM Zoho attachments] Backfill deferred:",error instanceof Error?error.message:"unknown");
      }
    }
    return json({ ok: true, scanned: listedMessages.length, matched: candidates.length, imported, attachments_updated:attachmentsUpdated, already_known: knownIds.size, deferred, skipped }, 200, origin);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ZOHO_INBOX_SYNC_FAILED";
    console.error("[CRM Zoho inbox sync] Failed:", code);
    return json({ error: code.startsWith("ZOHO_") || code.startsWith("CRM_") ? code : "ZOHO_INBOX_SYNC_FAILED" }, 502, origin);
  }
});


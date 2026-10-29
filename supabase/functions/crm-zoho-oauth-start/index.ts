import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://www.crm.fashionfussion.in",
  "https://crm.fashionfussion.in",
]);
const callbackUrl = "https://gmdevprqtvoshbbytsxf.supabase.co/functions/v1/crm-zoho-oauth-callback";
const scopes = "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE";
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
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function accountsDomain(): string {
  const value = (Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") || "https://accounts.zoho.in").replace(/\/+$/g, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !/^accounts\.zoho\.(in|com|eu|com\.au|jp|ca|sa|uk)$/.test(parsed.hostname)) {
    throw new Error("ZOHO_ACCOUNTS_DOMAIN_INVALID");
  }
  return value;
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, null);
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
  const requestBody = await req.json().catch(() => ({}));
  const mailboxAddress = String(requestBody?.mailbox_address || "").trim().toLowerCase();
  const mailboxDepartments: Record<string, string> = {
    "admin@fashionfussion.in": "administrator",
  };
  const department = mailboxDepartments[mailboxAddress];
  if (!department) return json({ error: "CRM_MAILBOX_NOT_ALLOWED" }, 400, origin);

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

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) return json({ error: "INVALID_SESSION" }, 401, origin);

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || profile?.is_admin !== true) {
    return json({ error: "ADMINISTRATOR_REQUIRED" }, 403, origin);
  }

  let authDomain: string;
  try {
    authDomain = accountsDomain();
  } catch {
    return json({ error: "ZOHO_ACCOUNTS_DOMAIN_INVALID" }, 503, origin);
  }

  const state = randomState();
  const stateHash = await sha256Hex(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: stateError } = await db.rpc("crm_create_zoho_oauth_state", {
    p_state_hash: stateHash,
    p_actor_user_id: user.id,
    p_expires_at: expiresAt,
    p_mailbox_address: mailboxAddress,
    p_department: department,
  });
  if (stateError) {
    console.error("[CRM Zoho OAuth] Could not create one-time state:", stateError.message);
    return json({ error: "OAUTH_START_FAILED" }, 500, origin);
  }

  const authorize = new URL(authDomain + "/oauth/v2/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", callbackUrl);
  authorize.searchParams.set("scope", scopes);
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");
  authorize.searchParams.set("state", state);

  return json({ ok: true, authorization_url: authorize.toString() }, 200, origin);
});


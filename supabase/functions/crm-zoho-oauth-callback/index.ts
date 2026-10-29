import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const callbackUrl = "https://gmdevprqtvoshbbytsxf.supabase.co/functions/v1/crm-zoho-oauth-callback";
const crmUrl = "https://www.crm.fashionfussion.in/crm";

function accountsDomain(): string {
  const value = (Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") || "https://accounts.zoho.in").replace(/\/+$/g, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !/^accounts\.zoho\.(in|com|eu|com\.au|jp|ca|sa|uk)$/.test(parsed.hostname)) {
    throw new Error("ZOHO_ACCOUNTS_DOMAIN_INVALID");
  }
  return value;
}
function page(success: boolean, message: string, mailboxAddress = ""): Response {
  const title = success ? "Zoho Mail connected" : "Zoho Mail setup not completed";
  const color = success ? "#067647" : "#b42318";
  const returnUrl = new URL(crmUrl);
  returnUrl.searchParams.set("zoho_oauth", success ? "connected" : "denied");
  if (mailboxAddress) returnUrl.searchParams.set("zoho_mailbox", mailboxAddress);
  returnUrl.hash = "crmTeamManagement";
  const link = returnUrl.toString();
  const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + title + "</title></head><body style=\"font-family:Arial,sans-serif;margin:48px auto;max-width:640px;padding:24px;color:#17202a\">" +
    "<h1>" + title + "</h1><p style=\"color:" + color + "\">" + message + "</p>" +
    "<p>No email was sent by this authorization step.</p><p><a href=\"" + link + "\">Return to CRM</a></p></body></html>";
  return new Response(html, {
    status: success ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return page(false, "This OAuth callback only accepts Zoho's GET redirect.");

  const callbackParams = new URL(req.url).searchParams;
  const code = callbackParams.get("code") || "";
  const state = callbackParams.get("state") || "";
  const oauthError = callbackParams.get("error") || "";
  if (!state || state.length > 256) return page(false, "The authorization state is missing or invalid.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const clientId = Deno.env.get("ZOHO_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET") || "";
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    return page(false, "Zoho OAuth server configuration is incomplete. Ask a CRM administrator to finish setup.");
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stateHash = await sha256Hex(state);
  const { data: stateData, error: stateError } = await db.rpc("crm_consume_zoho_oauth_state", {
    p_state_hash: stateHash,
  });
  if (stateError || !stateData?.actor_user_id || !stateData?.mailbox_address || !stateData?.department) {
    return page(false, "This authorization request expired or was already used. Start a new connection from CRM.");
  }
  const actorId = String(stateData.actor_user_id);
  const mailboxAddress = String(stateData.mailbox_address).trim().toLowerCase();
  const department = String(stateData.department).trim().toLowerCase();

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("is_admin")
    .eq("id", actorId)
    .maybeSingle();
  if (profileError || profile?.is_admin !== true) {
    return page(false, "The CRM administrator could not be verified. Start a new connection from CRM.", mailboxAddress);
  }
  if (oauthError) return page(false, "Zoho authorization was denied or cancelled.", mailboxAddress);
  if (!code || code.length > 4096) return page(false, "Zoho did not return a valid authorization code.", mailboxAddress);

  let authDomain: string;
  try {
    authDomain = accountsDomain();
  } catch {
    return page(false, "The Zoho accounts region is not configured correctly.", mailboxAddress);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl,
    code,
  });
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(authDomain + "/oauth/v2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
    });
  } catch {
    return page(false, "Zoho token exchange could not reach the authorization service. Start a new connection after checking the regional domain.", mailboxAddress);
  }
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload?.refresh_token) {
    console.error("[CRM Zoho OAuth] Token exchange failed with HTTP", tokenResponse.status);
    return page(false, "Zoho did not issue a refresh token. Check the OAuth client, region and offline access request, then try again.", mailboxAddress);
  }

  const returnedScopes = typeof tokenPayload.scope === "string"
    ? tokenPayload.scope.split(/[,\s]+/).map((scope: string) => scope.toLowerCase()).filter(Boolean)
    : [];
  if (returnedScopes.length && (
    !returnedScopes.some((scope: string) => scope === "zohomail.accounts.read" || scope === "zohomail.accounts.all") ||
    !returnedScopes.some((scope: string) => scope === "zohomail.messages.read" || scope === "zohomail.messages.all") ||
    !returnedScopes.some((scope: string) => scope === "zohomail.messages.create" || scope === "zohomail.messages.all")
  )) {
    return page(false, "Zoho authorization needs account-read, message-read and message-create access. Reconnect and approve the requested scopes.", mailboxAddress);
  }

  const mailApiBase = (Deno.env.get("ZOHO_MAIL_API_BASE") || "https://mail.zoho.in/api").replace(/\/+$/g, "");
  let accountsResponse: Response;
  try {
    accountsResponse = await fetch(mailApiBase + "/accounts", {
      method: "GET",
      headers: { "authorization": "Zoho-oauthtoken " + String(tokenPayload.access_token || ""), "accept": "application/json" },
      redirect: "error",
    });
  } catch {
    return page(false, "Zoho authorized the app, but the mailbox account list could not be read. Check the Zoho Mail API region and try again.", mailboxAddress);
  }
  const accountsPayload = await accountsResponse.json().catch(() => ({}));
  const accounts = Array.isArray(accountsPayload?.data) ? accountsPayload.data : [];
  const matchedAccount = accounts.find((account: any) => {
    const primaryAddresses = [account?.primaryEmailAddress, account?.mailboxAddress];
    return primaryAddresses.some((value: unknown) => String(value || "").trim().toLowerCase() === mailboxAddress);
  });
  const zohoAccountId = String(matchedAccount?.accountId || matchedAccount?.account_id || "");
  if (!accountsResponse.ok || !zohoAccountId || mailboxAddress !== "admin@fashionfussion.in" || department !== "administrator") {
    return page(false, "Sign in to the primary Zoho mailbox admin@fashionfussion.in and start the connection again.", mailboxAddress);
  }

  const { error: storeError } = await db.rpc("crm_store_zoho_mailbox_token", {
    p_actor_user_id: actorId,
    p_mailbox_address: mailboxAddress,
    p_department: department,
    p_zoho_account_id: zohoAccountId,
    p_refresh_token: String(tokenPayload.refresh_token),
  });
  if (storeError) {
    console.error("[CRM Zoho OAuth] Vault storage failed:", storeError.message);
    return page(false, "Zoho authorized the CRM, but the refresh token could not be saved securely. Contact the CRM administrator.", mailboxAddress);
  }

  return page(true, "Connected " + mailboxAddress + ". The credential was saved server-side in Supabase Vault.", mailboxAddress);
});


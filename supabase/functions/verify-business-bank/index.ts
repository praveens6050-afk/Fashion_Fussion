import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://fashionfussion.in",
  "https://www.fashionfussion.in",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://www.fashionfussion.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}
function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(req, { error: "Sign in is required." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: "Server configuration is incomplete." }, 503);

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user) return json(req, { error: "Your session is invalid or expired." }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid request body." }, 400); }

  const holder = String(body.account_holder_name ?? "").trim();
  const bankAccount = digits(body.bank_account);
  const ifsc = String(body.ifsc ?? "").trim().toUpperCase();
  const accountType = body.account_type === "savings" ? "savings" : "current";
  if (holder.length < 2 || holder.length > 120) return json(req, { error: "Enter a valid account holder name." }, 400);
  if (!/^[0-9]{6,34}$/.test(bankAccount)) return json(req, { error: "Enter a valid bank account number." }, 400);
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return json(req, { error: "Enter a valid IFSC." }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from("profiles").select("phone,account_type").eq("id", user.id).maybeSingle();
  const { data: business } = await admin.from("business_profiles").select("business_name").eq("user_id", user.id).maybeSingle();
  if (!business?.business_name) return json(req, { error: "Create your Business & Bulk profile before bank verification." }, 409);
  const phone = digits(profile?.phone);
  if (phone.length < 8 || phone.length > 13) return json(req, { error: "Add a valid phone number to your profile before bank verification." }, 409);

  const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET") || "";
  const baseUrl = (Deno.env.get("CASHFREE_SECURE_ID_BASE_URL") || "https://api.cashfree.com").replace(/\/+$/, "");
  if (!clientId || !clientSecret) return json(req, { error: "Cashfree Secure ID bank verification is not configured on the server." }, 503);

  try {
    const response = await fetch(`${baseUrl}/verification/bank-account/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": clientId, "x-client-secret": clientSecret },
      body: JSON.stringify({ bank_account: bankAccount, ifsc, name: holder, phone }),
    });
    const provider: Record<string, unknown> = await response.json().catch(() => ({}));
    const accountStatus = String(provider.account_status ?? "").toUpperCase();
    const accountStatusCode = String(provider.account_status_code ?? "").toUpperCase();
    const verified = response.ok && (accountStatus === "VALID" || accountStatusCode === "ACCOUNT_IS_VALID");
    const reference = provider.reference_id == null ? null : String(provider.reference_id);
    const bankName = String(provider.bank_name ?? "").trim() || null;
    const failure = verified ? null : String(provider.message ?? provider.account_status_code ?? provider.account_status ?? "Bank account could not be verified.").slice(0, 500);

    const row = {
      user_id: user.id,
      account_holder_name: String(provider.name_at_bank ?? holder).trim().slice(0, 120) || holder,
      bank_name: bankName,
      ifsc,
      account_number_last4: bankAccount.slice(-4),
      account_type: accountType,
      provider: "cashfree_secure_id",
      provider_reference: reference,
      verification_status: verified ? "verified" : "failed",
      verified_at: verified ? new Date().toISOString() : null,
      failure_reason: failure,
      updated_at: new Date().toISOString(),
    };
    const { error: saveError } = await admin.from("business_bank_profiles").upsert(row, { onConflict: "user_id" });
    if (saveError) return json(req, { error: "Verification completed, but the masked result could not be saved." }, 500);

    return json(req, {
      ok: true,
      verified,
      message: verified ? "Bank account verified." : failure,
      bank: { account_holder_name: row.account_holder_name, bank_name: bankName, ifsc, account_number_last4: row.account_number_last4, account_type: accountType, verification_status: row.verification_status },
    }, verified ? 200 : 422);
  } catch (error) {
    console.error("business bank verification failed", error);
    return json(req, { error: "Bank verification service is temporarily unavailable." }, 502);
  }
});

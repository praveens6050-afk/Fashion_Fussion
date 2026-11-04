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
  if ("bank_account" in body) return json(req, { error: "Full account numbers are not accepted. Only the last four digits may be submitted." }, 400);

  const holder = String(body.account_holder_name ?? "").trim();
  const bankName = String(body.bank_name ?? "").trim().slice(0, 120);
  const accountLast4 = digits(body.account_number_last4);
  const ifsc = String(body.ifsc ?? "").trim().toUpperCase();
  const accountType = body.account_type === "savings" ? "savings" : "current";
  if (holder.length < 2 || holder.length > 120) return json(req, { error: "Enter a valid account holder name." }, 400);
  if (!bankName) return json(req, { error: "Enter a bank name." }, 400);
  if (!/^[0-9]{4}$/.test(accountLast4)) return json(req, { error: "Submit only the last four account digits." }, 400);
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return json(req, { error: "Enter a valid IFSC." }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: business, error: businessError } = await admin.from("business_profiles").select("business_name").eq("user_id", user.id).maybeSingle();
  if (businessError) return json(req, { error: "Business profile could not be checked. Please try again." }, 500);
  if (!business?.business_name) return json(req, { error: "Create your Business & Bulk profile before bank review." }, 409);

  const row = {
    user_id: user.id,
    account_holder_name: holder,
    bank_name: bankName,
    ifsc,
    account_number_last4: accountLast4,
    account_type: accountType,
    provider: "manual_admin_review",
    provider_reference: null,
    verification_status: "pending",
    verified_at: null,
    failure_reason: null,
    updated_at: new Date().toISOString(),
  };
  const { error: saveError } = await admin.from("business_bank_profiles").upsert(row, { onConflict: "user_id" });
  if (saveError) return json(req, { error: "Bank details could not be submitted for manual review. Please try again." }, 500);

  return json(req, {
    ok: true,
    verified: false,
    manual_review_pending: true,
    status: "pending_review",
    message: "Bank details submitted for manual review.",
    bank: { account_holder_name: holder, bank_name: bankName, ifsc, account_number_last4: accountLast4, account_type: accountType, verification_status: "pending" },
  });
});

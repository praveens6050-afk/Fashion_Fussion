async function userSupabaseFetch(env, path, token) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error("seller_auth_not_configured");
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

function sellerChecklist(profile, compliance, submissions) {
  const tasks = [];
  if (!profile) return [{ key: "seller_profile", status: "missing", action: "Complete seller registration" }];
  if (profile.status !== "active") tasks.push({ key: "seller_activation", status: profile.status, action: "Wait for the seller account review or contact seller support" });
  if (!compliance) {
    tasks.push({ key: "compliance_profile", status: "missing", action: "Complete the business compliance profile" });
  } else {
    if (compliance.verification_status !== "verified") tasks.push({ key: "compliance_verification", status: compliance.verification_status, action: "Review the compliance checklist and resolve any requested information" });
    if (compliance.gst_registered && compliance.gst_verification_status !== "verified") tasks.push({ key: "gst_verification", status: compliance.gst_verification_status, action: "Check GST verification status in the seller portal" });
    if (compliance.pan_verification_status !== "verified") tasks.push({ key: "pan_verification", status: compliance.pan_verification_status, action: "Check PAN verification status in the seller portal" });
  }
  const pending = submissions.filter((item) => ["pending", "submitted", "under_review", "needs_changes"].includes(item.status));
  if (pending.length) tasks.push({ key: "product_submissions", status: "attention_required", count: pending.length, action: "Review product submission feedback and update any items that need changes" });
  return tasks;
}

export function buildSellerAssistResponse(profile, compliance, submissions = []) {
  return {
    seller: profile ? { storeName: profile.store_name, sellerCode: profile.seller_code, status: profile.status, sellerType: profile.seller_type } : null,
    checklist: sellerChecklist(profile, compliance, submissions),
    productSubmissions: submissions.map((item) => ({
      id: item.id, sku: item.sku, name: item.name, status: item.status,
      submittedAt: item.submitted_at, rejectionReason: item.rejection_reason
    })),
    mode: "read_only_assist",
    note: "This assistant cannot approve a seller, verify identity, change payout details, or activate an account."
  };
}

export async function handleSellerAssist(request, env, json) {
  const auth = request.headers.get("Authorization") || "";
  const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "user_authentication_required" }, 401);
  const token = tokenMatch[1].trim();
  if (!token || token.length > 8192) return json({ error: "invalid_user_token" }, 401);

  let user;
  try {
    user = await userSupabaseFetch(env, "/auth/v1/user", token);
  } catch {
    return json({ error: "user_authentication_failed" }, 401);
  }
  if (!user?.id) return json({ error: "user_authentication_failed" }, 401);

  const profileQuery = new URLSearchParams({
    select: "store_name,seller_code,status,seller_type",
    user_id: `eq.${user.id}`,
    limit: "1"
  });
  let profiles;
  try {
    profiles = await userSupabaseFetch(env, `/rest/v1/seller_profiles?${profileQuery.toString()}`, token);
  } catch {
    return json({ error: "seller_profile_lookup_failed" }, 502);
  }
  if (!Array.isArray(profiles) || !profiles[0]) {
    return json({ assist: buildSellerAssistResponse(null, null, []) }, 200);
  }

  const complianceQuery = new URLSearchParams({
    select: "entity_type,gst_registered,verification_status,pan_verification_status,gst_verification_status",
    seller_id: `eq.${user.id}`,
    limit: "1"
  });
  const submissionsQuery = new URLSearchParams({
    select: "id,sku,name,status,submitted_at,rejection_reason",
    seller_id: `eq.${user.id}`,
    order: "submitted_at.desc",
    limit: "50"
  });
  let compliance = null;
  let submissions = [];
  try {
    const [complianceRows, submissionRows] = await Promise.all([
      userSupabaseFetch(env, `/rest/v1/seller_compliance_profiles?${complianceQuery.toString()}`, token),
      userSupabaseFetch(env, `/rest/v1/seller_product_submissions?${submissionsQuery.toString()}`, token)
    ]);
    compliance = Array.isArray(complianceRows) ? complianceRows[0] || null : null;
    submissions = Array.isArray(submissionRows) ? submissionRows : [];
  } catch {
    return json({ error: "seller_onboarding_lookup_failed" }, 502);
  }
  return json({ assist: buildSellerAssistResponse(profiles[0], compliance, submissions) }, 200);
}

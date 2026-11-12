  const approvalReviewMatch = url.pathname.match(/^\/v1\/admin\/approvals\/([0-9a-f-]{36})\/review$/i);
  if ((request.method === "GET" && url.pathname === "/v1/admin/approvals") ||
      (request.method === "POST" && approvalReviewMatch)) {
    // Approval records may only be exposed to a preview backed by an isolated database.
    // Defaulting this gate off prevents a preview Worker from touching production records.
    if (env.AGENT_APPROVALS_READY !== "true") {
      return json({ error: "approval_api_not_ready" }, 503, cors);
    }
    const admin = await authenticateAdmin(request, env);
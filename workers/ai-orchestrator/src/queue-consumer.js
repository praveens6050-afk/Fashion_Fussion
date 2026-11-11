import { runAgentDraft } from "./agent-runner.js";

async function databaseRequest(env, path, init = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_not_configured");
  const response = await fetch(new URL(path, env.SUPABASE_URL), {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`supabase_http_${response.status}`);
  return body ? JSON.parse(body) : null;
}

async function writeEvent(env, runId, eventType, detail = {}) {
  await databaseRequest(env, "/rest/v1/ai_agent_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ run_id: runId, event_type: eventType, detail })
  });
}

export async function processAgentMessage(message, env) {
  const payload = message.body || {};
  if (env.AGENT_RUNTIME_READY !== "true") {
    message.retry({ delaySeconds: 60 });
    return { deferred: true };
  }
  if (typeof payload.run_id !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.run_id)) {
    message.ack();
    return { ignored: true };
  }

  const query = new URLSearchParams({
    select: "id,agent_id,action,status,input",
    id: `eq.${payload.run_id}`,
    limit: "1"
  });
  const rows = await databaseRequest(env, `/rest/v1/ai_agent_runs?${query.toString()}`);
  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run || run.status !== "queued") {
    message.ack();
    return { ignored: true };
  }

  const agentQuery = new URLSearchParams({
    select: "agent_id,enabled",
    agent_id: `eq.${run.agent_id}`,
    limit: "1"
  });
  const agentRows = await databaseRequest(env, `/rest/v1/ai_agent_registry?${agentQuery.toString()}`);
  if (!Array.isArray(agentRows) || !agentRows[0]?.enabled) {
    await databaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${run.id}&status=eq.queued`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "cancelled", error_code: "agent_disabled", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    });
    await writeEvent(env, run.id, "run_cancelled_agent_disabled", { agent_id: run.agent_id });
    message.ack();
    return { ignored: true, reason: "agent_disabled" };
  }

  const claim = await databaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${run.id}&status=eq.queued`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  });
  if (!Array.isArray(claim) || !claim.length) {
    message.ack();
    return { ignored: true };
  }

  await writeEvent(env, run.id, "run_started", { agent_id: run.agent_id, action: run.action });
  try {
    const result = await runAgentDraft(env, { agentId: run.agent_id, action: run.action, input: run.input || {} });
    await databaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${run.id}&status=eq.running`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "succeeded",
        output: { text: result.output, model: result.model, execution_mode: result.execution_mode, side_effects_performed: false },
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    await writeEvent(env, run.id, "run_succeeded", { model: result.model, execution_mode: "draft_only" });
    message.ack();
    return { succeeded: true };
  } catch (error) {
    const errorCode = String(error?.message || "agent_execution_failed").replace(/[^A-Za-z0-9_:-]/g, "_").slice(0, 80);
    const attempts = Number(message.attempts || 1);
    const exhausted = attempts >= 3;
    await databaseRequest(env, `/rest/v1/ai_agent_runs?id=eq.${run.id}&status=eq.running`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: exhausted ? "failed" : "queued",
        error_code: errorCode,
        ...(exhausted ? { finished_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString()
      })
    }).catch(() => {});
    await writeEvent(env, run.id, exhausted ? "run_failed" : "run_retry_scheduled", { error_code: errorCode, attempt: attempts }).catch(() => {});
    if (exhausted) {
      message.ack();
      return { failed: true, error_code: errorCode };
    }
    message.retry({ delaySeconds: Math.min(300, attempts * 30) });
    return { retrying: true, error_code: errorCode };
  }
}

export async function handleAgentQueue(batch, env) {
  for (const message of batch.messages || []) {
    try {
      await processAgentMessage(message, env);
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}

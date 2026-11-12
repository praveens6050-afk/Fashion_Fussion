'use strict';
(function () {
  const host = String(window.location.hostname || '').toLowerCase();
  // The default orchestrator URL is preview-only. Never forward a live CRM session to it.
  const isCrmPreview = host !== 'fashion-fussion-crm.pages.dev' && host.endsWith('.fashion-fussion-crm.pages.dev');
  // Keep the panel inert until a separately isolated preview database and gated Worker are deployed.
  const previewApprovalBackendReady = window.FF_AI_APPROVALS_PREVIEW_READY === true;
  if (!isCrmPreview || !previewApprovalBackendReady) return;
  const db = window.supabaseClient;
  if (!db) return;
  const API_BASE = String(window.FF_AI_ORCHESTRATOR_URL || 'https://fashion-fussion-ai-orchestrator-preview.praveen-s6050.workers.dev').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let busy = false;

  function mount() {
    const container = $('dashboard')?.querySelector('.container');
    if (!container || $('ffAiApprovals')) return;
    const section = document.createElement('section');
    section.id = 'ffAiApprovals';
    section.className = 'crm-welcome card';
    section.innerHTML = '<div class="card-body"><div class="ff-ai-head"><div><h2>AI Agent Approval Queue</h2><p>Review sensitive agent actions. Approval does not enable agents or bypass runtime safeguards.</p></div><button type="button" class="secondary" id="ffAiRefresh">Refresh queue</button></div><p class="crm-team-notice" id="ffAiNotice" role="status" aria-live="polite">Connecting to the preview orchestrator…</p><div id="ffAiRows" class="ff-ai-rows"><p>Loading approvals…</p></div><p class="ff-ai-footnote">Preview API · Admin-only · Approved work remains held while the global runtime switch is off. No external messages, payments, refunds or publishing are triggered by this panel.</p></div>';
    const style = document.createElement('style');
    style.id = 'ffAiApprovalsStyle';
    style.textContent = '#ffAiApprovals{margin-top:20px}#ffAiApprovals .ff-ai-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}#ffAiApprovals .ff-ai-head h2{margin:0 0 6px}#ffAiApprovals .ff-ai-head p{margin:0;color:#667085;line-height:1.5}#ffAiApprovals .ff-ai-rows{display:grid;gap:12px;margin-top:12px}#ffAiApprovals .ff-ai-item{border:1px solid #e4e7ec;border-radius:10px;padding:14px;background:#fff}#ffAiApprovals .ff-ai-item-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}#ffAiApprovals .ff-ai-item h3{margin:0;font-size:15px}#ffAiApprovals .ff-ai-meta{font-size:12px;color:#667085;margin-top:6px;overflow-wrap:anywhere}#ffAiApprovals .ff-ai-note{display:block;width:100%;box-sizing:border-box;min-height:68px;margin-top:12px;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;resize:vertical}#ffAiApprovals .ff-ai-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}#ffAiApprovals .ff-ai-actions button{padding:9px 12px}#ffAiApprovals .ff-ai-status{font-size:11px;font-weight:700;padding:5px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;white-space:nowrap}#ffAiApprovals .ff-ai-footnote{font-size:11px;color:#667085;line-height:1.5;margin-top:16px}@media(max-width:620px){#ffAiApprovals .ff-ai-head{flex-direction:column}#ffAiApprovals .ff-ai-head button{width:100%}}';
    document.head.appendChild(style);
    container.appendChild(section);
    $('ffAiRefresh').addEventListener('click', load);
    $('ffAiRows').addEventListener('click', reviewClick);
    load();
  }

  function notice(message, type) {
    const el = $('ffAiNotice');
    if (!el) return;
    el.textContent = message;
    el.style.color = type === 'error' ? '#b42318' : type === 'success' ? '#067647' : '#475467';
  }

  async function request(path, options) {
    const { data, error } = await db.auth.getSession();
    if (error) throw new Error('Could not verify your CRM session. Please sign in again.');
    const token = data?.session?.access_token;
    if (!token) throw new Error('Your session has expired. Please sign in again.');
    const response = await fetch(API_BASE + path, {
      ...options,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(options?.headers || {}) },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || ('Approval API returned HTTP ' + response.status));
    return body;
  }

  async function load() {
    if (busy) return;
    busy = true;
    const button = $('ffAiRefresh');
    if (button) button.disabled = true;
    const rows = $('ffAiRows');
    if (rows) rows.textContent = 'Loading pending approvals…';
    notice('Checking admin access and loading the approval queue…');
    try {
      const result = await request('/v1/admin/approvals');
      render(result.approvals || []);
      notice((result.count || 0) + ' pending approval(s).', 'success');
    } catch (error) {
      if (rows) rows.textContent = 'Approval queue is unavailable.';
      notice(error.message || 'Could not load approvals.', 'error');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  function render(approvals) {
    const host = $('ffAiRows');
    if (!host) return;
    if (!approvals.length) {
      host.innerHTML = '<div class="ff-ai-item"><strong>No pending approvals</strong><p class="ff-ai-meta">New requests requiring review will appear here.</p></div>';
      return;
    }
    host.innerHTML = approvals.map((approval) => {
      const id = String(approval.id || '');
      const run = approval.run || {};
      return '<article class="ff-ai-item" data-approval-id="' + esc(id) + '"><div class="ff-ai-item-head"><div><h3>' + esc(run.agent_id || 'Unknown agent') + ' · ' + esc(approval.action_key || run.action || 'Action') + '</h3><div class="ff-ai-meta">Run: ' + esc(run.id || approval.run_id || '—') + ' · Created: ' + esc(approval.created_at ? new Date(approval.created_at).toLocaleString('en-IN') : '—') + '</div></div><span class="ff-ai-status">Pending review</span></div><div class="ff-ai-meta">Current run status: ' + esc(run.status || 'awaiting approval') + ' · Expires: ' + esc(approval.expires_at ? new Date(approval.expires_at).toLocaleString('en-IN') : '—') + '</div><label class="ff-ai-meta" for="ffAiNote-' + esc(id) + '">Review note (required for rejection; optional for approval)</label><textarea class="ff-ai-note" id="ffAiNote-' + esc(id) + '" maxlength="2000" placeholder="Add a short review note…"></textarea><div class="ff-ai-actions"><button type="button" class="primary" data-decision="approved">Approve</button><button type="button" class="danger" data-decision="rejected">Reject</button></div></article>';
    }).join('');
  }

  async function reviewClick(event) {
    const button = event.target.closest('button[data-decision]');
    if (!button || busy) return;
    const card = button.closest('[data-approval-id]');
    const approvalId = card?.dataset.approvalId;
    if (!approvalId || !/^[0-9a-f-]{36}$/i.test(approvalId)) return;
    const decision = button.dataset.decision;
    const note = card.querySelector('textarea')?.value.trim() || '';
    if (decision === 'rejected' && !note) {
      notice('Please add a rejection reason before rejecting.', 'error');
      card.querySelector('textarea')?.focus();
      return;
    }
    if (!window.confirm(decision === 'approved' ? 'Approve this action for the agent workflow? Runtime safeguards still apply.' : 'Reject this agent action?')) return;
    busy = true;
    card.querySelectorAll('button').forEach((item) => { item.disabled = true; });
    notice('Saving your review…');
    try {
      const result = await request('/v1/admin/approvals/' + approvalId + '/review', { method: 'POST', body: JSON.stringify({ decision, note }) });
      notice(decision === 'approved' ? 'Approval recorded. Dispatch status: ' + (result.dispatch || 'not started') + '.' : 'Approval rejected. No job was dispatched.', 'success');
      await loadAfterReview();
    } catch (error) {
      notice(error.message || 'Review could not be saved.', 'error');
      card.querySelectorAll('button').forEach((item) => { item.disabled = false; });
    } finally {
      busy = false;
    }
  }

  async function loadAfterReview() {
    try {
      const result = await request('/v1/admin/approvals');
      render(result.approvals || []);
    } catch (error) {
      notice('Review saved, but queue refresh failed: ' + (error.message || 'unknown error'), 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
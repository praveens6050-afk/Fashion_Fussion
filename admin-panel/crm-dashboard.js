'use strict';
const BACKEND_URL = window.FF_API_ORIGIN || '';
let currentUser = null, currentSession = null;
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => '₹' + Number(v || 0).toLocaleString('en-IN', {maximumFractionDigits:2});

function showStatus(msg, type='ok') {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status show ' + type;
  setTimeout(() => { if(s.textContent === msg) s.className = 'status'; }, 4000);
}

function deny(msg) {
  $('loadingScreen').hidden = true;
  $('dashboard').hidden = true;
  $('dashboard').dataset.adminReady = 'false';
  $('accessDenied').hidden = false;
  $('accessDeniedMessage').textContent = msg;
}

async function checkAccess() {
  const { data: { session }, error } = await window.supabaseClient.auth.getSession();
  currentSession = session;
  if (error || !session?.user) { deny('Please sign in with an authorized account.'); return false; }
  currentUser = session.user;
  const { data: p, error: pe } = await window.supabaseClient.from('profiles').select('is_admin').eq('id', currentUser.id).maybeSingle();
  if (pe || !p?.is_admin) { deny('This account is not authorized to access the CRM Panel.'); return false; }
  $('adminEmail').textContent = currentUser.email || 'Administrator';
  $('loadingScreen').hidden = true;
  $('accessDenied').hidden = true;
  $('dashboard').hidden = false;
  $('dashboard').dataset.adminReady = 'true';
  return true;
}

let currentTab = 'overview';

function activeTab(name, btn) {
  document.querySelectorAll('[data-crm-tab]').forEach(b => b.classList.toggle('active', b === btn || (b.dataset.crmTab === name && !btn)));
}

async function showTab(name, btn) {
  currentTab = name;
  activeTab(name, btn);
  const box = $('crmBody');
  box.innerHTML = '<p>Loading…</p>';
  try {
    if (name === 'overview') await renderOverview(box);
    else if (name === 'accounts') await renderAccounts(box);
    else if (name === 'deals') await renderDeals(box);
    else if (name === 'leads') await renderLeads(box);
    else if (name === 'tickets') await renderTickets(box);
    else if (name === 'campaigns') await renderCampaigns(box);
    else if (name === 'team') await renderTeam(box);
  } catch(e) { console.error(e); box.innerHTML = '<div class="status show err">' + esc(e.message || 'Could not load CRM data.') + '</div>'; }
}

/* ============ OVERVIEW ============ */
async function renderOverview(box) {
  const [{ data: accounts, count: ac }, { data: deals }, { data: leads, count: lc }, { data: tickets, count: tc }, { data: campaigns, count: cc }, { data: team, count: tmc }] = await Promise.all([
    window.supabaseClient.from('crm_b2b_accounts').select('id,account_status', { count: 'exact', head: true }),
    window.supabaseClient.from('crm_b2b_deals').select('id,stage,estimated_value'),
    window.supabaseClient.from('seller_leads').select('id,lead_status', { count: 'exact', head: true }),
    window.supabaseClient.from('support_tickets').select('id,status', { count: 'exact', head: true }),
    window.supabaseClient.from('crm_marketing_campaigns').select('id,status', { count: 'exact', head: true }),
    window.supabaseClient.from('crm_team_members').select('user_id', { count: 'exact', head: true })
  ]);

  const dealValue = (deals || []).reduce((s, d) => s + (Number(d.estimated_value) || 0), 0);
  const wonDeals = (deals || []).filter(d => d.stage === 'closed_won').length;
  const openTickets = tc || 0;

  const stats = [
    ['B2B Accounts', ac || 0],
    ['Active Deals', (deals || []).filter(d => d.stage !== 'closed_won' && d.stage !== 'closed_lost').length],
    ['Pipeline Value', money(dealValue)],
    ['Won Deals', wonDeals],
    ['Seller Leads', lc || 0],
    ['Open Tickets', openTickets],
    ['Campaigns', cc || 0],
    ['Team Members', tmc || 0]
  ];

  box.innerHTML = '<div class="crm-grid">' + stats.map(([k,v]) => '<div class="crm-card"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('') + '</div>' +
    '<div class="card"><div class="card-header"><h2>Recent Sales Activities</h2></div><div class="card-body" id="activitiesBody">Loading…</div></div>';

  const { data: activities } = await window.supabaseClient.from('crm_sales_activities')
    .select('id,activity_type,summary,created_at,deal_id')
    .order('created_at', { ascending: false }).limit(10);
  const ab = $('activitiesBody');
  if (!activities?.length) { ab.innerHTML = '<p>No recent activities.</p>'; return; }
  ab.innerHTML = '<div class="crm-list">' + activities.map(a => '<div class="crm-row" style="cursor:default"><div><b>' + esc(a.activity_type) + '</b><small>' + esc(a.summary || '') + '</small></div><div>Deal #' + esc(a.deal_id || '—') + '</div><div><span class="badge">' + esc(new Date(a.created_at).toLocaleDateString()) + '</span></div><div></div><div></div></div>').join('') + '</div>';
}

/* ============ B2B ACCOUNTS ============ */
async function renderAccounts(box) {
  box.innerHTML = '<div class="crm-search"><input id="acSearch" placeholder="Search company name, GSTIN or email"><button class="secondary" id="acSearchBtn">Search</button><button class="primary" id="acAddBtn">+ Add Account</button></div><div id="acList" class="crm-list"></div><div id="acDetail"></div>';
  $('acSearchBtn').onclick = loadAccounts;
  $('acAddBtn').onclick = () => openAccountModal();
  let timer; $('acSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(loadAccounts, 300); };
  await loadAccounts();
}

async function loadAccounts() {
  const q = $('acSearch').value.trim();
  let qb = window.supabaseClient.from('crm_b2b_accounts').select('*').order('created_at', { ascending: false }).limit(50);
  if (q) qb = qb.or('company_name.ilike.%' + q + '%,billing_email.ilike.%' + q + '%,gstin.ilike.%' + q + '%');
  const { data, error } = await qb;
  if (error) throw error;
  const rows = $('acList');
  if (!data?.length) { rows.innerHTML = '<p>No accounts found.</p>'; return; }
  rows.innerHTML = data.map(x => '<div class="crm-row" data-account="' + x.id + '"><div><b>' + esc(x.company_name) + '</b><small>' + esc(x.gstin || '—') + ' · ' + esc(x.billing_email || '—') + '</small></div><div>' + money(x.credit_limit || 0) + '</div><div><span class="badge badge-' + (x.account_status === 'active' ? 'won' : 'cold') + '">' + esc(x.account_status || 'prospect') + '</span></div><div>' + esc(new Date(x.created_at).toLocaleDateString()) + '</div><div><button class="secondary">Open</button></div></div>').join('');
  rows.querySelectorAll('[data-account]').forEach(b => b.onclick = () => showAccountDetail(b.dataset.account));
}

function showAccountDetail(id) {
  window.supabaseClient.from('crm_b2b_accounts').select('*').eq('id', id).single().then(({ data, error }) => {
    if (error || !data) return;
    const d = $('acDetail');
    d.innerHTML = '<div class="crm-detail"><h3>' + esc(data.company_name) + '</h3><div class="meta"><span><b>GSTIN:</b> ' + esc(data.gstin || '—') + '</span><span><b>Email:</b> ' + esc(data.billing_email || '—') + '</span><span><b>Credit Limit:</b> ' + money(data.credit_limit || 0) + '</span><span><b>Status:</b> ' + esc(data.account_status || '—') + '</span><span><b>Created:</b> ' + esc(new Date(data.created_at).toLocaleDateString()) + '</span></div><p>' + esc(data.notes || '') + '</p></div>';
  });
}

function openAccountModal(account) {
  const isEdit = !!account;
  $('modalTitle').textContent = isEdit ? 'Edit Account' : 'Add Account';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Company Name</label><input id="a_name" required></div><div><label>GSTIN</label><input id="a_gstin"></div><div><label>Billing Email</label><input id="a_email" type="email"></div><div><label>Credit Limit</label><input id="a_credit" type="number" min="0" step="0.01"></div><div><label>Status</label><select id="a_status"><option value="prospect">Prospect</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></div><div class="full"><label>Notes</label><textarea id="a_notes"></textarea></div></div>';
  if (isEdit) {
    $('a_name').value = account.company_name || '';
    $('a_gstin').value = account.gstin || '';
    $('a_email').value = account.billing_email || '';
    $('a_credit').value = account.credit_limit || 0;
    $('a_status').value = account.account_status || 'prospect';
    $('a_notes').value = account.notes || '';
  }
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      company_name: $('a_name').value.trim(),
      gstin: $('a_gstin').value.trim() || null,
      billing_email: $('a_email').value.trim() || null,
      credit_limit: Number($('a_credit').value) || 0,
      account_status: $('a_status').value,
      notes: $('a_notes').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    if (!payload.company_name) { showStatus('Company name is required.', 'err'); return; }
    try {
      let error;
      if (isEdit) ({ error } = await window.supabaseClient.from('crm_b2b_accounts').update(payload).eq('id', account.id));
      else ({ error } = await window.supabaseClient.from('crm_b2b_accounts').insert({ ...payload, created_by: currentUser.id }));
      if (error) throw error;
      closeModal(); showStatus(isEdit ? 'Account updated.' : 'Account added.'); await loadAccounts();
    } catch(err) { showStatus(err.message || 'Could not save account.', 'err'); }
  };
  openModal();
}

/* ============ DEALS PIPELINE ============ */
async function renderDeals(box) {
  box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><h2 style="margin:0">Sales Pipeline</h2><button class="primary" id="dealAddBtn">+ Add Deal</button></div><div class="pipeline" id="pipeline"></div>';
  $('dealAddBtn').onclick = () => openDealModal();
  await loadPipeline();
}

async function loadPipeline() {
  const stages = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
  const { data: deals, error } = await window.supabaseClient.from('crm_b2b_deals').select('*,crm_b2b_accounts(company_name)').order('created_at', { ascending: false });
  if (error) throw error;
  const pipe = $('pipeline');
  pipe.innerHTML = stages.map(stage => {
    const stageDeals = (deals || []).filter(d => d.stage === stage);
    const stageValue = stageDeals.reduce((s, d) => s + (Number(d.estimated_value) || 0), 0);
    return '<div class="stage"><h4>' + esc(stage.replace('_', ' ')) + '</h4><div class="count">' + stageDeals.length + ' deals · ' + money(stageValue) + '</div>' + stageDeals.map(d => '<div class="stage-card" data-deal="' + d.id + '"><b>' + esc(d.title) + '</b><span>' + esc(d.crm_b2b_accounts?.company_name || '—') + ' · ' + money(d.estimated_value || 0) + '</span></div>').join('') + '</div>';
  }).join('');
  pipe.querySelectorAll('[data-deal]').forEach(b => b.onclick = () => openDealEdit(b.dataset.deal, deals));
}

async function openDealEdit(id, dealsList) {
  const deal = (dealsList || []).find(d => String(d.id) === String(id));
  if (!deal) return;
  const { data: accounts } = await window.supabaseClient.from('crm_b2b_accounts').select('id,company_name').order('company_name');
  $('modalTitle').textContent = 'Edit Deal';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Deal Title</label><input id="d_title" required></div><div><label>Account</label><select id="d_account_id"></select></div><div><label>Stage</label><select id="d_stage"><option value="prospecting">Prospecting</option><option value="qualification">Qualification</option><option value="proposal">Proposal</option><option value="negotiation">Negotiation</option><option value="closed_won">Closed Won</option><option value="closed_lost">Closed Lost</option></select></div><div><label>Estimated Value</label><input id="d_value" type="number" min="0" step="0.01"></div><div><label>Expected Close</label><input id="d_close" type="date"></div><div class="full"><label>Next Action</label><textarea id="d_action"></textarea></div></div>';
  const accSel = $('d_account_id');
  accSel.innerHTML = (accounts || []).map(a => '<option value="' + a.id + '">' + esc(a.company_name) + '</option>').join('');
  $('d_title').value = deal.title || '';
  $('d_account_id').value = deal.account_id || '';
  $('d_stage').value = deal.stage || 'prospecting';
  $('d_value').value = deal.estimated_value || 0;
  $('d_close').value = deal.expected_close_date ? deal.expected_close_date.split('T')[0] : '';
  $('d_action').value = deal.next_action || '';
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      title: $('d_title').value.trim(),
      account_id: $('d_account_id').value || null,
      stage: $('d_stage').value,
      estimated_value: Number($('d_value').value) || 0,
      expected_close_date: $('d_close').value || null,
      next_action: $('d_action').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    if (!payload.title) { showStatus('Deal title is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('crm_b2b_deals').update(payload).eq('id', deal.id);
      if (error) throw error;
      closeModal(); showStatus('Deal updated.'); await loadPipeline();
    } catch(err) { showStatus(err.message || 'Could not save deal.', 'err'); }
  };
  openModal();
}

function openDealModal() {
  window.supabaseClient.from('crm_b2b_accounts').select('id,company_name').order('company_name').then(({ data: accounts }) => {
    $('modalTitle').textContent = 'Add Deal';
    $('modalBody').innerHTML = '<div class="crm-form"><div><label>Deal Title</label><input id="d_title" required></div><div><label>Account</label><select id="d_account_id"></select></div><div><label>Stage</label><select id="d_stage"><option value="prospecting">Prospecting</option><option value="qualification">Qualification</option><option value="proposal">Proposal</option><option value="negotiation">Negotiation</option><option value="closed_won">Closed Won</option><option value="closed_lost">Closed Lost</option></select></div><div><label>Estimated Value</label><input id="d_value" type="number" min="0" step="0.01"></div><div><label>Expected Close</label><input id="d_close" type="date"></div><div class="full"><label>Next Action</label><textarea id="d_action"></textarea></div></div>';
    const accSel = $('d_account_id');
    accSel.innerHTML = '<option value="">— Select Account —</option>' + (accounts || []).map(a => '<option value="' + a.id + '">' + esc(a.company_name) + '</option>').join('');
    $('crmForm').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        title: $('d_title').value.trim(),
        account_id: $('d_account_id').value || null,
        stage: $('d_stage').value,
        estimated_value: Number($('d_value').value) || 0,
        expected_close_date: $('d_close').value || null,
        next_action: $('d_action').value.trim() || null,
        created_by: currentUser.id
      };
      if (!payload.title) { showStatus('Deal title is required.', 'err'); return; }
      try {
        const { error } = await window.supabaseClient.from('crm_b2b_deals').insert(payload);
        if (error) throw error;
        closeModal(); showStatus('Deal added.'); await loadPipeline();
      } catch(err) { showStatus(err.message || 'Could not save deal.', 'err'); }
    };
    openModal();
  });
}

/* ============ LEADS ============ */
async function renderLeads(box) {
  box.innerHTML = '<div class="crm-search"><input id="leadSearch" placeholder="Search company name, city, source or contact"><button class="secondary" id="leadSearchBtn">Search</button><button class="primary" id="leadAddBtn">+ Add Lead</button></div><div id="leadList" class="crm-list"></div>';
  $('leadSearchBtn').onclick = loadLeads;
  $('leadAddBtn').onclick = () => openLeadModal();
  let timer; $('leadSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(loadLeads, 300); };
  await loadLeads();
}

async function loadLeads() {
  const q = $('leadSearch').value.trim();
  let qb = window.supabaseClient.from('seller_leads').select('*').order('created_at', { ascending: false }).limit(50);
  if (q) qb = qb.or('company_name.ilike.%' + q + '%,city.ilike.%' + q + '%,public_contact_name.ilike.%' + q + '%,source_marketplace.ilike.%' + q + '%');
  const { data, error } = await qb;
  if (error) throw error;
  const rows = $('leadList');
  if (!data?.length) { rows.innerHTML = '<p>No leads found.</p>'; return; }
  rows.innerHTML = data.map(x => '<div class="crm-row" data-lead="' + x.id + '"><div><b>' + esc(x.company_name || 'Unnamed') + '</b><small>' + esc(x.public_contact_name || '') + ' · ' + esc(x.city || '') + '</small></div><div><span class="badge badge-' + (x.lead_status === 'converted' ? 'won' : x.lead_status === 'rejected' ? 'lost' : 'warm') + '">' + esc(x.lead_status || 'new') + '</span></div><div>' + esc(x.source_marketplace || '—') + '</div><div>' + esc(new Date(x.created_at).toLocaleDateString()) + '</div><div><button class="secondary">Open</button></div></div>').join('');
  rows.querySelectorAll('[data-lead]').forEach(b => b.onclick = () => openLeadEdit(b.dataset.lead));
}

async function openLeadEdit(id) {
  const { data: lead } = await window.supabaseClient.from('seller_leads').select('*').eq('id', id).single();
  if (!lead) return;
  $('modalTitle').textContent = 'Edit Lead';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Company Name</label><input id="l_name" required></div><div><label>Contact Name</label><input id="l_contact"></div><div><label>Email</label><input id="l_email" type="email"></div><div><label>Phone</label><input id="l_phone"></div><div><label>City</label><input id="l_city"></div><div><label>State</label><input id="l_state"></div><div><label>Source Marketplace</label><input id="l_source"></div><div><label>Category</label><input id="l_category"></div><div><label>Business Type</label><input id="l_business_type"></div><div><label>Status</label><select id="l_status"><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="converted">Converted</option><option value="rejected">Rejected</option></select></div><div><label>Priority</label><select id="l_priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div><div class="full"><label>Notes</label><textarea id="l_notes"></textarea></div></div>';
  $('l_name').value = lead.company_name || '';
  $('l_contact').value = lead.public_contact_name || '';
  $('l_email').value = lead.public_contact_email || '';
  $('l_phone').value = lead.public_contact_phone || '';
  $('l_city').value = lead.city || '';
  $('l_state').value = lead.state || '';
  $('l_source').value = lead.source_marketplace || '';
  $('l_category').value = lead.category || '';
  $('l_business_type').value = lead.business_type || '';
  $('l_status').value = lead.lead_status || 'new';
  $('l_priority').value = lead.priority || 'medium';
  $('l_notes').value = lead.notes || '';
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      company_name: $('l_name').value.trim(),
      public_contact_name: $('l_contact').value.trim() || null,
      public_contact_email: $('l_email').value.trim() || null,
      public_contact_phone: $('l_phone').value.trim() || null,
      city: $('l_city').value.trim() || null,
      state: $('l_state').value.trim() || null,
      source_marketplace: $('l_source').value.trim() || null,
      category: $('l_category').value.trim() || null,
      business_type: $('l_business_type').value.trim() || null,
      lead_status: $('l_status').value,
      priority: $('l_priority').value,
      notes: $('l_notes').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    if (!payload.company_name) { showStatus('Company name is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('seller_leads').update(payload).eq('id', id);
      if (error) throw error;
      closeModal(); showStatus('Lead updated.'); await loadLeads();
    } catch(err) { showStatus(err.message || 'Could not save lead.', 'err'); }
  };
  openModal();
}

function openLeadModal() {
  $('modalTitle').textContent = 'Add Lead';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Company Name</label><input id="l_name" required></div><div><label>Contact Name</label><input id="l_contact"></div><div><label>Email</label><input id="l_email" type="email"></div><div><label>Phone</label><input id="l_phone"></div><div><label>City</label><input id="l_city"></div><div><label>State</label><input id="l_state"></div><div><label>Source Marketplace</label><input id="l_source"></div><div><label>Category</label><input id="l_category"></div><div><label>Business Type</label><input id="l_business_type"></div><div><label>Status</label><select id="l_status"><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="converted">Converted</option><option value="rejected">Rejected</option></select></div><div><label>Priority</label><select id="l_priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div><div class="full"><label>Notes</label><textarea id="l_notes"></textarea></div></div>';
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      company_name: $('l_name').value.trim(),
      public_contact_name: $('l_contact').value.trim() || null,
      public_contact_email: $('l_email').value.trim() || null,
      public_contact_phone: $('l_phone').value.trim() || null,
      city: $('l_city').value.trim() || null,
      state: $('l_state').value.trim() || null,
      source_marketplace: $('l_source').value.trim() || null,
      category: $('l_category').value.trim() || null,
      business_type: $('l_business_type').value.trim() || null,
      lead_status: $('l_status').value,
      priority: $('l_priority').value,
      notes: $('l_notes').value.trim() || null
    };
    if (!payload.company_name) { showStatus('Company name is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('seller_leads').insert(payload);
      if (error) throw error;
      closeModal(); showStatus('Lead added.'); await loadLeads();
    } catch(err) { showStatus(err.message || 'Could not save lead.', 'err'); }
  };
  openModal();
}

/* ============ SUPPORT TICKETS ============ */
async function renderTickets(box) {
  box.innerHTML = '<div class="crm-search"><input id="tkSearch" placeholder="Search ticket subject or issue type"><button class="secondary" id="tkSearchBtn">Search</button><button class="primary" id="tkAddBtn">+ Add Ticket</button></div><div id="tkList" class="crm-list"></div>';
  $('tkSearchBtn').onclick = loadTickets;
  $('tkAddBtn').onclick = () => openTicketModal();
  let timer; $('tkSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(loadTickets, 300); };
  await loadTickets();
}

async function loadTickets() {
  const q = $('tkSearch').value.trim();
  let qb = window.supabaseClient.from('support_tickets').select('*,profiles(full_name,email)').order('created_at', { ascending: false }).limit(50);
  if (q) qb = qb.or('subject.ilike.%' + q + '%,issue_type.ilike.%' + q + '%');
  const { data, error } = await qb;
  if (error) throw error;
  const rows = $('tkList');
  if (!data?.length) { rows.innerHTML = '<p>No tickets found.</p>'; return; }
  rows.innerHTML = data.map(x => '<div class="crm-row" data-ticket="' + x.id + '"><div><b>' + esc(x.subject) + '</b><small>' + esc(x.profiles?.full_name || x.profiles?.email || '') + ' · ' + esc(x.issue_type || '') + '</small></div><div><span class="ticket-priority ' + esc(x.priority || 'low') + '">' + esc(x.priority || 'low') + '</span></div><div><span class="ticket-status ' + esc(x.status || 'open') + '">' + esc(x.status || 'open') + '</span></div><div>' + esc(new Date(x.created_at).toLocaleDateString()) + '</div><div><button class="secondary">Open</button></div></div>').join('');
  rows.querySelectorAll('[data-ticket]').forEach(b => b.onclick = () => openTicketEdit(b.dataset.ticket));
}

async function openTicketEdit(id) {
  const { data: ticket } = await window.supabaseClient.from('support_tickets').select('*').eq('id', id).single();
  if (!ticket) return;
  $('modalTitle').textContent = 'Edit Ticket #' + esc(ticket.ticket_code || id);
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Subject</label><input id="t_subject" required></div><div><label>Issue Type</label><input id="t_type"></div><div><label>Priority</label><select id="t_priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div><div><label>Status</label><select id="t_status"><option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div><div><label>Support Mode</label><select id="t_mode"><option value="bot">Bot</option><option value="human">Human</option><option value="hybrid">Hybrid</option></select></div><div class="full"><label>Resolution Summary</label><textarea id="t_resolution"></textarea></div></div>';
  $('t_subject').value = ticket.subject || '';
  $('t_type').value = ticket.issue_type || '';
  $('t_priority').value = ticket.priority || 'low';
  $('t_status').value = ticket.status || 'open';
  $('t_mode').value = ticket.support_mode || 'bot';
  $('t_resolution').value = ticket.resolution_summary || '';
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      subject: $('t_subject').value.trim(),
      issue_type: $('t_type').value.trim() || null,
      priority: $('t_priority').value,
      status: $('t_status').value,
      support_mode: $('t_mode').value,
      resolution_summary: $('t_resolution').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    if (!payload.subject) { showStatus('Subject is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('support_tickets').update(payload).eq('id', id);
      if (error) throw error;
      closeModal(); showStatus('Ticket updated.'); await loadTickets();
    } catch(err) { showStatus(err.message || 'Could not save ticket.', 'err'); }
  };
  openModal();
}

function openTicketModal() {
  $('modalTitle').textContent = 'Add Ticket';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Subject</label><input id="t_subject" required></div><div><label>Issue Type</label><input id="t_type"></div><div><label>Priority</label><select id="t_priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div><div><label>Status</label><select id="t_status"><option value="open">Open</option><option value="pending">Pending</option></select></div><div><label>Support Mode</label><select id="t_mode"><option value="bot">Bot</option><option value="human">Human</option></select></div><div class="full"><label>Resolution Summary</label><textarea id="t_resolution"></textarea></div></div>';
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      subject: $('t_subject').value.trim(),
      issue_type: $('t_type').value.trim() || null,
      priority: $('t_priority').value,
      status: $('t_status').value,
      support_mode: $('t_mode').value,
      resolution_summary: $('t_resolution').value.trim() || null
    };
    if (!payload.subject) { showStatus('Subject is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('support_tickets').insert(payload);
      if (error) throw error;
      closeModal(); showStatus('Ticket created.'); await loadTickets();
    } catch(err) { showStatus(err.message || 'Could not create ticket.', 'err'); }
  };
  openModal();
}

/* ============ CAMPAIGNS ============ */
async function renderCampaigns(box) {
  box.innerHTML = '<div class="crm-search"><input id="campSearch" placeholder="Search campaign name"><button class="secondary" id="campSearchBtn">Search</button><button class="primary" id="campAddBtn">+ Add Campaign</button></div><div id="campList" class="crm-list"></div>';
  $('campSearchBtn').onclick = loadCampaigns;
  $('campAddBtn').onclick = () => openCampaignModal();
  let timer; $('campSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(loadCampaigns, 300); };
  await loadCampaigns();
}

async function loadCampaigns() {
  const q = $('campSearch').value.trim();
  let qb = window.supabaseClient.from('crm_marketing_campaigns').select('*').order('created_at', { ascending: false }).limit(50);
  if (q) qb = qb.ilike('name', '%' + q + '%');
  const { data, error } = await qb;
  if (error) throw error;
  const rows = $('campList');
  if (!data?.length) { rows.innerHTML = '<p>No campaigns found.</p>'; return; }
  rows.innerHTML = data.map(x => '<div class="crm-row" data-campaign="' + x.id + '"><div><b>' + esc(x.name) + '</b><small>' + esc(x.channel || '—') + ' · ' + esc(x.objective || '—') + '</small></div><div><span class="badge badge-' + (x.status === 'active' ? 'won' : x.status === 'completed' ? 'cold' : 'warm') + '">' + esc(x.status || 'draft') + '</span></div><div>' + esc(x.starts_at ? new Date(x.starts_at).toLocaleDateString() : '—') + '</div><div>' + money(x.budget || 0) + '</div><div><button class="secondary">Open</button></div></div>').join('');
  rows.querySelectorAll('[data-campaign]').forEach(b => b.onclick = () => openCampaignEdit(b.dataset.campaign));
}

async function openCampaignEdit(id) {
  const { data: camp } = await window.supabaseClient.from('crm_marketing_campaigns').select('*').eq('id', id).single();
  if (!camp) return;
  $('modalTitle').textContent = 'Edit Campaign';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Name</label><input id="c_name" required></div><div><label>Channel</label><input id="c_channel" placeholder="email, social, sms, etc"></div><div><label>Objective</label><input id="c_objective"></div><div><label>Status</label><select id="c_status"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></div><div><label>Budget</label><input id="c_budget" type="number" min="0" step="0.01"></div><div><label>Start Date</label><input id="c_start" type="datetime-local"></div><div><label>End Date</label><input id="c_end" type="datetime-local"></div><div class="full"><label>Notes</label><textarea id="c_notes"></textarea></div></div>';
  $('c_name').value = camp.name || '';
  $('c_channel').value = camp.channel || '';
  $('c_objective').value = camp.objective || '';
  $('c_status').value = camp.status || 'draft';
  $('c_budget').value = camp.budget || 0;
  $('c_start').value = camp.starts_at ? camp.starts_at.slice(0,16) : '';
  $('c_end').value = camp.ends_at ? camp.ends_at.slice(0,16) : '';
  $('c_notes').value = camp.notes || '';
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: $('c_name').value.trim(),
      channel: $('c_channel').value.trim() || null,
      objective: $('c_objective').value.trim() || null,
      status: $('c_status').value,
      budget: Number($('c_budget').value) || 0,
      starts_at: $('c_start').value || null,
      ends_at: $('c_end').value || null,
      notes: $('c_notes').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    if (!payload.name) { showStatus('Name is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('crm_marketing_campaigns').update(payload).eq('id', id);
      if (error) throw error;
      closeModal(); showStatus('Campaign updated.'); await loadCampaigns();
    } catch(err) { showStatus(err.message || 'Could not save campaign.', 'err'); }
  };
  openModal();
}

function openCampaignModal() {
  $('modalTitle').textContent = 'Add Campaign';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Name</label><input id="c_name" required></div><div><label>Channel</label><input id="c_channel" placeholder="email, social, sms, etc"></div><div><label>Objective</label><input id="c_objective"></div><div><label>Status</label><select id="c_status"><option value="draft">Draft</option><option value="active">Active</option></select></div><div><label>Budget</label><input id="c_budget" type="number" min="0" step="0.01"></div><div><label>Start Date</label><input id="c_start" type="datetime-local"></div><div><label>End Date</label><input id="c_end" type="datetime-local"></div><div class="full"><label>Notes</label><textarea id="c_notes"></textarea></div></div>';
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: $('c_name').value.trim(),
      channel: $('c_channel').value.trim() || null,
      objective: $('c_objective').value.trim() || null,
      status: $('c_status').value,
      budget: Number($('c_budget').value) || 0,
      starts_at: $('c_start').value || null,
      ends_at: $('c_end').value || null,
      notes: $('c_notes').value.trim() || null,
      created_by: currentUser.id
    };
    if (!payload.name) { showStatus('Name is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('crm_marketing_campaigns').insert(payload);
      if (error) throw error;
      closeModal(); showStatus('Campaign added.'); await loadCampaigns();
    } catch(err) { showStatus(err.message || 'Could not save campaign.', 'err'); }
  };
  openModal();
}

/* ============ TEAM ============ */
async function renderTeam(box) {
  box.innerHTML = '<div class="crm-search"><input id="teamSearch" placeholder="Search team member name or role"><button class="secondary" id="teamSearchBtn">Search</button></div><div id="teamList" class="crm-list"></div>';
  $('teamSearchBtn').onclick = loadTeam;
  let timer; $('teamSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(loadTeam, 300); };
  await loadTeam();
}

async function loadTeam() {
  const q = $('teamSearch').value.trim();
  let qb = window.supabaseClient.from('crm_team_members').select('*,profiles(email,full_name)').order('created_at', { ascending: false }).limit(50);
  if (q) qb = qb.or('role.ilike.%' + q + '%,profiles.full_name.ilike.%' + q + '%');
  const { data, error } = await qb;
  if (error) throw error;
  const rows = $('teamList');
  if (!data?.length) { rows.innerHTML = '<p>No team members found.</p>'; return; }
  rows.innerHTML = data.map(x => '<div class="crm-row" data-member="' + x.user_id + '"><div><b>' + esc(x.profiles?.full_name || x.user_id?.slice(0,8)) + '</b><small>' + esc(x.profiles?.email || x.email || '') + '</small></div><div>' + esc(x.role || '—') + '</div><div><span class="badge badge-' + (x.is_active ? 'won' : 'lost') + '">' + (x.is_active ? 'Active' : 'Inactive') + '</span></div><div>' + esc(new Date(x.created_at).toLocaleDateString()) + '</div><div><button class="secondary">Open</button></div></div>').join('');
  rows.querySelectorAll('[data-member]').forEach(b => b.onclick = () => openTeamEdit(b.dataset.member));
}

async function openTeamEdit(uid) {
  const { data: member } = await window.supabaseClient.from('crm_team_members').select('*').eq('user_id', uid).single();
  if (!member) return;
  $('modalTitle').textContent = 'Edit Team Member';
  $('modalBody').innerHTML = '<div class="crm-form"><div><label>Role</label><input id="m_role" required></div><div><label>Email</label><input id="m_email" type="email"></div><div><label>Active</label><select id="m_active"><option value="true">Yes</option><option value="false">No</option></select></div></div>';
  $('m_role').value = member.role || '';
  $('m_email').value = member.email || '';
  $('m_active').value = String(Boolean(member.is_active));
  $('crmForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      role: $('m_role').value.trim(),
      email: $('m_email').value.trim() || null,
      is_active: $('m_active').value === 'true',
      updated_at: new Date().toISOString()
    };
    if (!payload.role) { showStatus('Role is required.', 'err'); return; }
    try {
      const { error } = await window.supabaseClient.from('crm_team_members').update(payload).eq('user_id', uid);
      if (error) throw error;
      closeModal(); showStatus('Member updated.'); await loadTeam();
    } catch(err) { showStatus(err.message || 'Could not save member.', 'err'); }
  };
  openModal();
}

/* ============ MODAL HELPERS ============ */
function openModal() { $('crmModal').classList.add('open'); }
function closeModal() { $('crmModal').classList.remove('open'); $('crmForm').reset(); $('modalBody').innerHTML = ''; }

/* ============ INIT ============ */
$('closeModal').onclick = closeModal;
$('cancelModal').onclick = closeModal;
$('logoutButton').onclick = async () => { await window.supabaseClient.auth.signOut(); location.href = 'login.html'; };
$('goToLoginButton').onclick = () => location.href = 'login.html';
$('refreshAll').onclick = () => showTab(currentTab);

document.querySelectorAll('[data-crm-tab]').forEach(b => b.onclick = () => showTab(b.dataset.crmTab, b));

async function init() {
  if (!await checkAccess()) return;
  await showTab('overview');
}
init().catch(e => { console.error(e); deny('CRM dashboard could not be loaded.'); });

'use strict';
(() => {
  if (window.__ffSellerFinanceComplianceLive) return;
  window.__ffSellerFinanceComplianceLive = true;
  const client = window.supabaseClient;
  if (!client) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => '₹' + Number(value || 0).toLocaleString('en-IN',{maximumFractionDigits:2});
  const notify = msg => window.SellerCatalogBridge?.notify?.(msg) || console.info(msg);
  let state = { compliance:{}, payout:{}, pickup_locations:[], settlements:[] };

  async function sellerSession(){
    const {data:{session},error}=await client.auth.getSession();
    if(error) throw error;
    if(!session?.user) return null;
    return session;
  }

  function statusLabel(value){
    const v = value || 'draft';
    return v === 'pending_review' ? 'Pending review' : v === 'verified' ? 'Verified' : v === 'rejected' ? 'Rejected' : 'Draft';
  }

  function injectStyles(){
    if($('ffSellerFinanceStyle')) return;
    const style=document.createElement('style');
    style.id='ffSellerFinanceStyle';
    style.textContent=`
      .ff-fin-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.ff-fin-card{background:#fff;border:1px solid var(--line);border-radius:15px;padding:18px}.ff-fin-card h2{font-size:15px;margin:0 0 4px}.ff-fin-card>p{font-size:10px;color:var(--muted);line-height:1.5;margin:0 0 14px}.ff-fin-card label{display:grid;gap:6px;font-size:11px;font-weight:700;color:#4d5668;margin-bottom:12px}.ff-fin-card input,.ff-fin-card select{width:100%;border:1px solid #dfe3ea;border-radius:9px;padding:10px 11px;background:#fff}.ff-fin-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.ff-fin-note{font-size:10px;line-height:1.5;padding:11px 12px;background:#f7f9fc;border:1px solid #e7ebf1;border-radius:10px;color:#5f6878;margin-bottom:12px}.ff-fin-status{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:9px;font-weight:800;background:#f3f5f8;color:#667085}.ff-fin-status.verified{background:#eaf8f0;color:#128a53}.ff-fin-status.pending_review{background:#fff6df;color:#8d610c}.ff-fin-status.rejected{background:#fff0f0;color:#b42318}.ff-pickup-row,.ff-settle-row{padding:12px 0;border-bottom:1px solid #eef0f4}.ff-pickup-row:last-child,.ff-settle-row:last-child{border-bottom:0}.ff-pickup-row strong,.ff-settle-row strong{font-size:11px}.ff-pickup-row span,.ff-settle-row span{display:block;font-size:9px;color:#7d8696;margin-top:4px}.ff-mask{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.ff-fin-empty{padding:18px 0;color:#7d8696;font-size:10px}@media(max-width:900px){.ff-fin-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function mount(){
    injectStyles();
    const profile=$('view-profile');
    if(!profile || $('ffSellerFinanceCompliance')) return;
    const host=document.createElement('div');
    host.id='ffSellerFinanceCompliance';
    host.className='ff-fin-grid';
    host.innerHTML=`
      <section class="ff-fin-card"><h2>Business verification</h2><p>Business identity for seller verification.</p><div id="ffComplianceStatus"></div><form id="ffComplianceForm">
        <label>Legal name<input id="ffLegalName" maxlength="120" required></label>
        <label>Trade / store name<input id="ffTradeName" maxlength="120"></label>
        <label>Entity type<select id="ffEntityType"><option value="individual">Individual / Proprietor</option><option value="business">Registered business</option><option value="manufacturer">Manufacturer / brand</option><option value="wholesaler">Wholesaler / distributor</option></select></label>
        <label>Primary category<input id="ffPrimaryCategory" maxlength="80"></label>
        <label>PAN<input id="ffPan" maxlength="10" autocomplete="off" placeholder="Required for verification"></label>
        <label><span><input id="ffGstRegistered" type="checkbox" style="width:auto"> GST registered</span></label>
        <label>GSTIN<input id="ffGstin" maxlength="15" autocomplete="off"></label>
        <h2 style="margin-top:18px">Payout account</h2><div class="ff-fin-note">Raw account number is used only for this save request. Database stores masked last-4 plus payout verification state; provider tokenization can replace this later.</div>
        <label>Account holder<input id="ffHolderName" maxlength="120"></label><label>Bank name<input id="ffBankName" maxlength="120"></label><label>IFSC<input id="ffIfsc" maxlength="11"></label><label>Account number<input id="ffAccountNumber" inputmode="numeric" maxlength="18" autocomplete="off"></label><label>Account type<select id="ffAccountType"><option value="current">Current</option><option value="savings">Savings</option></select></label>
        <div class="ff-fin-actions"><button class="primary" type="submit">Save verification setup</button><button class="ghost" type="button" id="ffSubmitVerification">Submit for review</button></div>
      </form></section>
      <section class="ff-fin-card"><h2>Pickup & logistics</h2><p>Primary seller dispatch address.</p><div id="ffPickupList"></div><form id="ffPickupForm"><input id="ffPickupId" type="hidden"><label>Label<input id="ffPickupLabel" maxlength="80" value="Primary pickup"></label><label>Contact name<input id="ffPickupContact" maxlength="120" required></label><label>Phone<input id="ffPickupPhone" inputmode="numeric" maxlength="10" required></label><label>Address line 1<input id="ffPickupLine1" maxlength="180" required></label><label>Address line 2<input id="ffPickupLine2" maxlength="180"></label><label>City<input id="ffPickupCity" maxlength="80" required></label><label>State<input id="ffPickupState" maxlength="80" required></label><label>Pincode<input id="ffPickupPincode" inputmode="numeric" maxlength="6" required></label><label>Landmark<input id="ffPickupLandmark" maxlength="120"></label><label><span><input id="ffPickupDefault" type="checkbox" style="width:auto" checked> Default pickup location</span></label><div class="ff-fin-actions"><button class="primary" type="submit">Save pickup location</button></div></form><h2 style="margin-top:20px">Settlement ledger</h2><p>Only real settlement records created by finance/admin are shown.</p><div id="ffSettlementList"></div></section>`;
    profile.appendChild(host);
    bind();
  }

  function render(){
    const c=state.compliance||{}, p=state.payout||{}, locations=state.pickup_locations||[], settlements=state.settlements||[];
    const status=$('ffComplianceStatus');
    if(status) status.innerHTML=`<div class="ff-fin-note">KYC: <span class="ff-fin-status ${esc(c.verification_status||'draft')}">${esc(statusLabel(c.verification_status))}</span> &nbsp; Payout: <span class="ff-fin-status ${esc(p.verification_status||'draft')}">${esc(statusLabel(p.verification_status))}</span>${c.pan_last4?`<br>PAN on file: <span class="ff-mask">••••••${esc(c.pan_last4)}</span>`:''}${p.account_number_last4?`<br>Bank account: <span class="ff-mask">••••${esc(p.account_number_last4)}</span>`:''}</div>`;
    if($('ffLegalName')) $('ffLegalName').value=c.legal_name||'';
    if($('ffTradeName')) $('ffTradeName').value=c.trade_name||'';
    if($('ffEntityType')) $('ffEntityType').value=c.entity_type||'individual';
    if($('ffPrimaryCategory')) $('ffPrimaryCategory').value=c.primary_category||'';
    if($('ffGstRegistered')) $('ffGstRegistered').checked=Boolean(c.gst_registered);
    if($('ffHolderName')) $('ffHolderName').value=p.account_holder_name||'';
    if($('ffBankName')) $('ffBankName').value=p.bank_name||'';
    if($('ffIfsc')) $('ffIfsc').value=p.ifsc||'';
    if($('ffAccountType')) $('ffAccountType').value=p.account_type||'current';
    if($('ffPan')) $('ffPan').value=''; if($('ffGstin')) $('ffGstin').value=''; if($('ffAccountNumber')) $('ffAccountNumber').value='';
    const kyc=$('kycStatus'); if(kyc) kyc.textContent=statusLabel(c.verification_status);
    const pickup=$('ffPickupList');
    if(pickup) pickup.innerHTML=locations.length?locations.map(row=>`<div class="ff-pickup-row"><strong>${esc(row.label||'Pickup')} ${row.is_default?'· Default':''}</strong><span>${esc(row.contact_name)} · ${esc(row.phone)}</span><span>${esc(row.line1)}${row.line2?', '+esc(row.line2):''}, ${esc(row.city)}, ${esc(row.state)} ${esc(row.pincode)}</span><button type="button" class="small-btn" data-ff-edit-pickup="${row.id}">Edit</button></div>`).join(''):'<div class="ff-fin-empty">No pickup location saved yet.</div>';
    const list=$('ffSettlementList');
    if(list) list.innerHTML=settlements.length?settlements.map(row=>`<div class="ff-settle-row"><strong>${esc(row.period_start)} → ${esc(row.period_end)} · ${money(row.net_amount)}</strong><span>${esc(statusLabel(row.status))} · Gross ${money(row.gross_amount)} · Fees ${money(row.fees_amount)} · Refunds ${money(row.refunds_amount)}</span></div>`).join(''):'<div class="ff-fin-empty">No real settlements yet.</div>';
  }

  async function load(){
    const session=await sellerSession(); if(!session) return;
    const {data,error}=await client.rpc('get_seller_finance_profile'); if(error) throw error;
    state=data||state; render();
  }

  async function saveCompliance(event){
    event.preventDefault();
    const params={p_legal_name:$('ffLegalName').value.trim(),p_trade_name:$('ffTradeName').value.trim(),p_entity_type:$('ffEntityType').value,p_primary_category:$('ffPrimaryCategory').value.trim(),p_gst_registered:$('ffGstRegistered').checked,p_pan:$('ffPan').value.trim(),p_gstin:$('ffGstin').value.trim(),p_account_holder_name:$('ffHolderName').value.trim(),p_bank_name:$('ffBankName').value.trim(),p_ifsc:$('ffIfsc').value.trim(),p_account_number:$('ffAccountNumber').value.trim(),p_account_type:$('ffAccountType').value};
    const {data,error}=await client.rpc('save_seller_compliance_profile',params); if(error) throw error;
    state=data||state; render(); notify('Verification setup saved securely.');
  }

  async function savePickup(event){
    event.preventDefault();
    const params={p_location_id:$('ffPickupId').value?Number($('ffPickupId').value):null,p_label:$('ffPickupLabel').value.trim(),p_contact_name:$('ffPickupContact').value.trim(),p_phone:$('ffPickupPhone').value.trim(),p_line1:$('ffPickupLine1').value.trim(),p_line2:$('ffPickupLine2').value.trim(),p_city:$('ffPickupCity').value.trim(),p_state:$('ffPickupState').value.trim(),p_pincode:$('ffPickupPincode').value.trim(),p_landmark:$('ffPickupLandmark').value.trim(),p_is_default:$('ffPickupDefault').checked};
    const {data,error}=await client.rpc('save_seller_pickup_location',params); if(error) throw error;
    state=data||state; render(); $('ffPickupForm').reset(); $('ffPickupLabel').value='Primary pickup'; $('ffPickupDefault').checked=true; $('ffPickupId').value=''; notify('Pickup location saved.');
  }

  async function submitVerification(){
    const {data,error}=await client.rpc('submit_seller_verification'); if(error) throw error;
    state=data||state; render(); notify('Verification submitted for admin review.');
  }

  function editPickup(id){
    const row=(state.pickup_locations||[]).find(x=>String(x.id)===String(id)); if(!row) return;
    $('ffPickupId').value=row.id; $('ffPickupLabel').value=row.label||''; $('ffPickupContact').value=row.contact_name||''; $('ffPickupPhone').value=row.phone||''; $('ffPickupLine1').value=row.line1||''; $('ffPickupLine2').value=row.line2||''; $('ffPickupCity').value=row.city||''; $('ffPickupState').value=row.state||''; $('ffPickupPincode').value=row.pincode||''; $('ffPickupLandmark').value=row.landmark||''; $('ffPickupDefault').checked=Boolean(row.is_default);
  }

  function bind(){
    $('ffComplianceForm')?.addEventListener('submit',e=>saveCompliance(e).catch(err=>notify(err.message||'Could not save verification setup.')));
    $('ffPickupForm')?.addEventListener('submit',e=>savePickup(e).catch(err=>notify(err.message||'Could not save pickup location.')));
    $('ffSubmitVerification')?.addEventListener('click',()=>submitVerification().catch(err=>notify(err.message||'Could not submit verification.')));
    document.addEventListener('click',e=>{const btn=e.target.closest?.('[data-ff-edit-pickup]'); if(btn) editPickup(btn.dataset.ffEditPickup)});
  }

  function init(){mount(); load().catch(err=>{console.error('Seller finance/compliance load failed',err); notify('Could not load KYC/payout setup.');});}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();

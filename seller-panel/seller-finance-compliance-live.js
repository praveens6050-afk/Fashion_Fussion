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
  let providers = { pan:false, gst:false, address:false };

  async function sellerSession(){
    const {data:{session},error}=await client.auth.getSession();
    if(error) throw error;
    if(!session?.user) return null;
    return session;
  }

  function statusLabel(value){
    const v = value || 'draft';
    return v === 'pending_review' ? 'Pending review' : v === 'verified' ? 'Verified' : v === 'rejected' ? 'Rejected' : v === 'unverified' ? 'Not verified' : 'Draft';
  }

  function verifyBadge(value){
    const v=value||'unverified';
    return `<span class="ff-fin-status ${esc(v)}">${esc(statusLabel(v))}</span>`;
  }

  function injectStyles(){
    if($('ffSellerFinanceStyle')) return;
    const style=document.createElement('style');
    style.id='ffSellerFinanceStyle';
    style.textContent=`
      .ff-fin-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.ff-fin-card{background:#fff;border:1px solid var(--line);border-radius:15px;padding:18px}.ff-fin-card h2{font-size:15px;margin:0 0 4px}.ff-fin-card>p{font-size:10px;color:var(--muted);line-height:1.5;margin:0 0 14px}.ff-fin-card label{display:grid;gap:6px;font-size:11px;font-weight:700;color:#4d5668;margin-bottom:12px}.ff-fin-card input,.ff-fin-card select{width:100%;border:1px solid #dfe3ea;border-radius:9px;padding:10px 11px;background:#fff}.ff-fin-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.ff-fin-note{font-size:10px;line-height:1.5;padding:11px 12px;background:#f7f9fc;border:1px solid #e7ebf1;border-radius:10px;color:#5f6878;margin-bottom:12px}.ff-fin-status{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:9px;font-weight:800;background:#f3f5f8;color:#667085}.ff-fin-status.verified{background:#eaf8f0;color:#128a53}.ff-fin-status.pending_review{background:#fff6df;color:#8d610c}.ff-fin-status.rejected{background:#fff0f0;color:#b42318}.ff-verify-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-5px 0 13px}.ff-verify-row small{color:#7d8696;font-size:9px}.ff-pickup-row,.ff-settle-row{padding:12px 0;border-bottom:1px solid #eef0f4}.ff-pickup-row:last-child,.ff-settle-row:last-child{border-bottom:0}.ff-pickup-row strong,.ff-settle-row strong{font-size:11px}.ff-pickup-row span,.ff-settle-row span{display:block;font-size:9px;color:#7d8696;margin-top:4px}.ff-mask{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.ff-fin-empty{padding:18px 0;color:#7d8696;font-size:10px}@media(max-width:900px){.ff-fin-grid{grid-template-columns:1fr}}
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
      <section class="ff-fin-card"><h2>Business verification</h2><p>Business identity is saved first, then verified only by configured external providers.</p><div id="ffComplianceStatus"></div><form id="ffComplianceForm">
        <label>Legal name<input id="ffLegalName" maxlength="120" required></label>
        <label>Trade / store name<input id="ffTradeName" maxlength="120"></label>
        <label>Entity type<select id="ffEntityType"><option value="individual">Individual / Proprietor</option><option value="business">Registered business</option><option value="manufacturer">Manufacturer / brand</option><option value="wholesaler">Wholesaler / distributor</option></select></label>
        <label>Primary category<input id="ffPrimaryCategory" maxlength="80"></label>
        <label>PAN<input id="ffPan" maxlength="10" autocomplete="off" placeholder="Enter PAN for verification"></label>
        <div class="ff-verify-row"><button class="ghost" type="button" id="ffVerifyPan">Verify PAN</button><small id="ffPanProviderState"></small></div>
        <label><span><input id="ffGstRegistered" type="checkbox" style="width:auto"> GST registered</span></label>
        <label>GSTIN<input id="ffGstin" maxlength="15" autocomplete="off" placeholder="Enter GSTIN for verification"></label>
        <div class="ff-verify-row"><button class="ghost" type="button" id="ffVerifyGst">Verify GSTIN</button><small id="ffGstProviderState"></small></div>
        <h2 style="margin-top:18px">Payout account</h2><div class="ff-fin-note">Raw account number is used only for this save/verification request. Database stores masked last-4 plus provider verification state.</div>
        <label>Account holder<input id="ffHolderName" maxlength="120"></label><label>Bank name<input id="ffBankName" maxlength="120"></label><label>IFSC<input id="ffIfsc" maxlength="11"></label><label>Account number<input id="ffAccountNumber" inputmode="numeric" maxlength="18" autocomplete="off"></label><label>Account type<select id="ffAccountType"><option value="current">Current</option><option value="savings">Savings</option></select></label>
        <div class="ff-fin-actions"><button class="primary" type="submit">Save verification setup</button><button class="ghost" type="button" id="ffSubmitVerification">Submit for review</button></div>
      </form></section>
      <section class="ff-fin-card"><h2>Pickup & logistics</h2><p>Save the dispatch address; Google Maps verification runs when configured.</p><div id="ffPickupList"></div><form id="ffPickupForm"><input id="ffPickupId" type="hidden"><label>Label<input id="ffPickupLabel" maxlength="80" value="Primary pickup"></label><label>Contact name<input id="ffPickupContact" maxlength="120" required></label><label>Phone<input id="ffPickupPhone" inputmode="numeric" maxlength="10" required></label><label>Address line 1<input id="ffPickupLine1" maxlength="180" required></label><label>Address line 2<input id="ffPickupLine2" maxlength="180"></label><label>City<input id="ffPickupCity" maxlength="80" required></label><label>State<input id="ffPickupState" maxlength="80" required></label><label>Pincode<input id="ffPickupPincode" inputmode="numeric" maxlength="6" required></label><label>Landmark<input id="ffPickupLandmark" maxlength="120"></label><label><span><input id="ffPickupDefault" type="checkbox" style="width:auto" checked> Default pickup location</span></label><div class="ff-fin-actions"><button class="primary" type="submit">Save & verify pickup location</button></div><div class="ff-fin-note" id="ffAddressProviderState"></div></form><h2 style="margin-top:20px">Settlement ledger</h2><p>Only real settlement records created by finance/admin are shown.</p><div id="ffSettlementList"></div></section>`;
    profile.appendChild(host);
    bind();
  }

  function renderProviderState(){
    const pan=$('ffPanProviderState'),gst=$('ffGstProviderState'),address=$('ffAddressProviderState');
    if(pan) pan.textContent=providers.pan?'Provider ready — save the PAN before verifying.':'PAN provider not configured; admin review remains available.';
    if(gst) gst.textContent=providers.gst?'GST provider ready — save the GSTIN before verifying.':'GST provider not configured; admin review remains available.';
    if(address) address.textContent=providers.address?'Google Maps verification is ready and will run after save.':'Google Maps API is not configured; pickup address can still be saved for admin review.';
    if($('ffVerifyPan')) $('ffVerifyPan').disabled=!providers.pan;
    if($('ffVerifyGst')) $('ffVerifyGst').disabled=!providers.gst;
  }

  function render(){
    const c=state.compliance||{}, p=state.payout||{}, locations=state.pickup_locations||[], settlements=state.settlements||[];
    const status=$('ffComplianceStatus');
    if(status) status.innerHTML=`<div class="ff-fin-note">KYC review: <span class="ff-fin-status ${esc(c.verification_status||'draft')}">${esc(statusLabel(c.verification_status))}</span> &nbsp; Payout review: <span class="ff-fin-status ${esc(p.verification_status||'draft')}">${esc(statusLabel(p.verification_status))}</span><br>PAN provider: ${verifyBadge(c.pan_verification_status)} &nbsp; GST provider: ${verifyBadge(c.gst_verification_status)} &nbsp; Bank provider: ${verifyBadge(p.bank_verification_status)}${c.pan_last4?`<br>PAN on file: <span class="ff-mask">••••••${esc(c.pan_last4)}</span>`:''}${p.account_number_last4?`<br>Bank account: <span class="ff-mask">••••${esc(p.account_number_last4)}</span>`:''}</div>`;
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
    if(pickup) pickup.innerHTML=locations.length?locations.map(row=>`<div class="ff-pickup-row"><strong>${esc(row.label||'Pickup')} ${row.is_default?'· Default':''}</strong><span>${esc(row.contact_name)} · ${esc(row.phone)}</span><span>${esc(row.line1)}${row.line2?', '+esc(row.line2):''}, ${esc(row.city)}, ${esc(row.state)} ${esc(row.pincode)}</span><div class="ff-verify-row">${verifyBadge(row.address_verification_status)}<button type="button" class="small-btn" data-ff-edit-pickup="${row.id}">Edit</button><button type="button" class="small-btn" data-ff-verify-address="${row.id}" ${providers.address?'':'disabled'}>Verify with Google Maps</button></div></div>`).join(''):'<div class="ff-fin-empty">No pickup location saved yet.</div>';
    const list=$('ffSettlementList');
    if(list) list.innerHTML=settlements.length?settlements.map(row=>`<div class="ff-settle-row"><strong>${esc(row.period_start)} → ${esc(row.period_end)} · ${money(row.net_amount)}</strong><span>${esc(statusLabel(row.status))} · Gross ${money(row.gross_amount)} · Fees ${money(row.fees_amount)} · Refunds ${money(row.refunds_amount)}</span></div>`).join(''):'<div class="ff-fin-empty">No real settlements yet.</div>';
    renderProviderState();
  }

  async function refreshProviders(){
    try{const r=await fetch('/api/identity-verify',{headers:{'Cache-Control':'no-store'}});const d=await r.json().catch(()=>({}));if(r.ok&&d.providers)providers={...providers,...d.providers}}catch{}
    renderProviderState();
  }

  async function load(){
    const session=await sellerSession(); if(!session) return;
    const {data,error}=await client.rpc('get_seller_finance_profile'); if(error) throw error;
    state=data||state; render();
  }

  async function verifyExternal(type,payload){
    const session=await sellerSession(); if(!session?.access_token) throw new Error('Seller session expired');
    const r=await fetch('/api/identity-verify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({type,...payload})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||'Verification failed');
    return d;
  }

  async function verifyPan(pan){
    const value=String(pan??$('ffPan')?.value??'').trim();
    if(!value) throw new Error('Enter PAN, save verification setup, then verify.');
    await verifyExternal('pan',{pan:value});
    await load(); notify('PAN verified by the configured verification provider.');
  }

  async function verifyGst(gstin){
    if(!$('ffGstRegistered')?.checked) throw new Error('Mark the seller as GST registered first.');
    const value=String(gstin??$('ffGstin')?.value??'').trim();
    if(!value) throw new Error('Enter GSTIN, save verification setup, then verify.');
    await verifyExternal('gst',{gstin:value});
    await load(); notify('GSTIN verified by the configured verification provider.');
  }

  async function verifyAddress(id){
    const row=(state.pickup_locations||[]).find(x=>String(x.id)===String(id));
    if(!row) throw new Error('Save this pickup address before verification.');
    await verifyExternal('address',{location_id:row.id,pincode:row.pincode});
    await load(); notify('Pickup address and pincode verified with Google Maps.');
  }

  async function saveCompliance(event){
    event.preventDefault();
    const pan=$('ffPan').value.trim(),gstin=$('ffGstin').value.trim(),gstRegistered=$('ffGstRegistered').checked;
    const params={p_legal_name:$('ffLegalName').value.trim(),p_trade_name:$('ffTradeName').value.trim(),p_entity_type:$('ffEntityType').value,p_primary_category:$('ffPrimaryCategory').value.trim(),p_gst_registered:gstRegistered,p_pan:pan,p_gstin:gstin,p_account_holder_name:$('ffHolderName').value.trim(),p_bank_name:$('ffBankName').value.trim(),p_ifsc:$('ffIfsc').value.trim(),p_account_number:$('ffAccountNumber').value.trim(),p_account_type:$('ffAccountType').value};
    const {data,error}=await client.rpc('save_seller_compliance_profile',params); if(error) throw error;
    state=data||state; render(); notify('Verification setup saved securely.');
    if(pan&&providers.pan) await verifyPan(pan).catch(err=>notify('PAN saved, but verification did not complete: '+err.message));
    if(gstRegistered&&gstin&&providers.gst) await verifyGst(gstin).catch(err=>notify('GSTIN saved, but verification did not complete: '+err.message));
  }

  async function savePickup(event){
    event.preventDefault();
    const snapshot={id:$('ffPickupId').value?Number($('ffPickupId').value):null,label:$('ffPickupLabel').value.trim(),contact:$('ffPickupContact').value.trim(),phone:$('ffPickupPhone').value.trim(),line1:$('ffPickupLine1').value.trim(),line2:$('ffPickupLine2').value.trim(),city:$('ffPickupCity').value.trim(),state:$('ffPickupState').value.trim(),pincode:$('ffPickupPincode').value.trim(),landmark:$('ffPickupLandmark').value.trim(),isDefault:$('ffPickupDefault').checked};
    const params={p_location_id:snapshot.id,p_label:snapshot.label,p_contact_name:snapshot.contact,p_phone:snapshot.phone,p_line1:snapshot.line1,p_line2:snapshot.line2,p_city:snapshot.city,p_state:snapshot.state,p_pincode:snapshot.pincode,p_landmark:snapshot.landmark,p_is_default:snapshot.isDefault};
    const {data,error}=await client.rpc('save_seller_pickup_location',params); if(error) throw error;
    state=data||state; render();
    const saved=(state.pickup_locations||[]).find(row=>snapshot.id?String(row.id)===String(snapshot.id):(String(row.pincode)===snapshot.pincode&&String(row.line1).trim()===snapshot.line1));
    $('ffPickupForm').reset(); $('ffPickupLabel').value='Primary pickup'; $('ffPickupDefault').checked=true; $('ffPickupId').value='';
    notify(providers.address?'Pickup location saved. Verifying with Google Maps…':'Pickup location saved. Google Maps verification is not configured yet.');
    if(providers.address&&saved) await verifyAddress(saved.id).catch(err=>notify('Pickup saved, but Google Maps verification did not complete: '+err.message));
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
    $('ffVerifyPan')?.addEventListener('click',()=>verifyPan().catch(err=>notify(err.message||'PAN verification failed.')));
    $('ffVerifyGst')?.addEventListener('click',()=>verifyGst().catch(err=>notify(err.message||'GST verification failed.')));
    document.addEventListener('click',e=>{const edit=e.target.closest?.('[data-ff-edit-pickup]');if(edit)editPickup(edit.dataset.ffEditPickup);const verify=e.target.closest?.('[data-ff-verify-address]');if(verify)verifyAddress(verify.dataset.ffVerifyAddress).catch(err=>notify(err.message||'Address verification failed.'))});
  }

  function init(){mount();Promise.all([refreshProviders(),load()]).catch(err=>{console.error('Seller finance/compliance load failed',err);notify('Could not load KYC/payout setup.');});}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
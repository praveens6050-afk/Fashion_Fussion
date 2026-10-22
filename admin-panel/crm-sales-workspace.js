'use strict';
(function(){
  const $=id=>document.getElementById(id), db=window.supabaseClient;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const role=()=>document.getElementById('dashboard')?.dataset.crmRole||'';
  const csvRows=text=>{
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++}else if(c==='"'){quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}else cell+=c}
    row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
  };
  function mount(){
    const host=$('crmDepartmentModules');if(!host||host.dataset.salesMounted==='true')return;host.dataset.salesMounted='true';
    host.innerHTML='<div class="card-body"><h2>Sales Team · Seller Acquisition</h2><p>Manual outreach only. No emails or WhatsApp messages are sent from this tool.</p><div class="crm-sales-tools"><label>Search leads <input id="salesSearch" type="search" placeholder="Business, city, phone, email"></label><label>Status <select id="salesStatus"><option value="">All statuses</option><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="converted">Converted</option><option value="not_interested">Not interested</option></select></label><button id="salesRefresh" type="button">Refresh</button></div><div class="crm-sales-import"><h3>Import seller leads (CSV)</h3><p>Export your Excel sheet as CSV UTF-8 first. Expected columns may include company_name/business_name, source_marketplace/source, source_url/website/instagram, category, city, state, public_contact_name, public_contact_phone/phone, public_contact_email/email, notes, priority. Unknown details stay blank.</p><input id="salesCsv" type="file" accept=".csv,text/csv"><button id="salesImport" type="button">Validate & import CSV</button><p id="salesNotice" role="status" aria-live="polite"></p></div><div class="crm-team-table-wrap"><table class="crm-team-table"><thead><tr><th>Business / Source</th><th>Contact</th><th>Location</th><th>Status</th><th>Priority</th><th>Assign to (Auth UUID)</th><th>Action</th></tr></thead><tbody id="salesRows"><tr><td colspan="7">Loading leads…</td></tr></tbody></table></div><div class="crm-sales-activity"><h3>Log manual activity / follow-up</h3><form id="salesActivityForm"><label>Lead ID <input id="salesActivityLead" required placeholder="Select a lead using Log activity"></label><label>Activity <select id="salesActivityType"><option value="call">Call</option><option value="email_log">Email (log only)</option><option value="note">Note</option><option value="follow_up">Follow-up</option><option value="meeting">Meeting</option><option value="sample">Sample</option></select></label><label>Summary <input id="salesActivitySummary" required maxlength="1000" placeholder="Outcome / next step"></label><label>Follow-up date <input id="salesActivityDate" type="datetime-local"></label><button type="submit">Save activity</button></form></div></div>';
    $('salesRefresh').addEventListener('click',load);
    $('salesSearch').addEventListener('input',render);
    $('salesStatus').addEventListener('change',render);
    $('salesImport').addEventListener('click',importCsv);
    $('salesActivityForm').addEventListener('submit',saveActivity);
    load();
  }
  let leads=[];
  async function load(){
    const note=$('salesNotice');if(note)note.textContent='Loading seller leads…';
    const {data,error}=await db.from('seller_leads').select('id,company_name,source_marketplace,source_url,category,city,state,public_contact_name,public_contact_phone,public_contact_email,lead_status,priority,assigned_to,notes,created_at').order('created_at',{ascending:false}).limit(1000);
    if(error){if(note)note.textContent='Could not load leads: '+error.message;return}
    leads=data||[];if(note)note.textContent=leads.length+' lead(s) loaded. No messages sent.';render();
  }
  function render(){
    const q=($('salesSearch')?.value||'').trim().toLowerCase(),status=$('salesStatus')?.value||'';
    const rows=leads.filter(x=>(!status||x.lead_status===status)&&(!q||[x.company_name,x.source_marketplace,x.source_url,x.public_contact_name,x.public_contact_phone,x.public_contact_email,x.city,x.state,x.category].some(v=>String(v||'').toLowerCase().includes(q))));
    $('salesRows').innerHTML=rows.map(x=>'<tr><td><strong>'+esc(x.company_name)+'</strong><br><a href="'+esc(x.source_url||'#')+'" target="_blank" rel="noopener noreferrer">'+esc(x.source_marketplace||'Source')+'</a><br><small>'+esc(x.category||'')+'</small></td><td>'+esc(x.public_contact_name||'')+'<br>'+esc(x.public_contact_phone||'')+'<br>'+esc(x.public_contact_email||'')+'</td><td>'+esc([x.city,x.state].filter(Boolean).join(', '))+'</td><td><select data-status="'+esc(x.id)+'"><option value="new" '+(x.lead_status==='new'?'selected':'')+'>New</option><option value="contacted" '+(x.lead_status==='contacted'?'selected':'')+'>Contacted</option><option value="shortlisted" '+(x.lead_status==='shortlisted'?'selected':'')+'>Shortlisted</option><option value="interested" '+(x.lead_status==='interested'?'selected':'')+'>Interested</option><option value="onboarding" '+(x.lead_status==='onboarding'?'selected':'')+'>Onboarding</option><option value="invalid" '+(x.lead_status==='invalid'?'selected':'')+'>Invalid</option><option value="converted" '+(x.lead_status==='converted'?'selected':'')+'>Converted</option><option value="not_interested" '+(x.lead_status==='not_interested'?'selected':'')+'>Not interested</option></select></td><td><select data-priority="'+esc(x.id)+'"><option value="low" '+(x.priority==='low'?'selected':'')+'>Low</option><option value="medium" '+(x.priority==='medium'?'selected':'')+'>Medium</option><option value="high" '+(x.priority==='high'?'selected':'')+'>High</option></select></td><td><input data-owner="'+esc(x.id)+'" value="'+esc(x.assigned_to||'')+'" placeholder="Sales user UUID" aria-label="Assigned Auth UUID"></td><td><button type="button" data-save="'+esc(x.id)+'">Save</button> <button type="button" data-log="'+esc(x.id)+'">Log activity</button></td></tr>').join('')||'<tr><td colspan="7">No matching leads.</td></tr>';
    $('salesRows').querySelectorAll('[data-save]').forEach(b=>b.addEventListener('click',()=>saveLead(b.dataset.save)));
    $('salesRows').querySelectorAll('[data-log]').forEach(b=>b.addEventListener('click',()=>{$('salesActivityLead').value=b.dataset.log;$('salesActivitySummary').focus()}));
  }
  async function saveLead(id){
    const status=$('salesRows').querySelector('[data-status="'+id+'"]').value,priority=$('salesRows').querySelector('[data-priority="'+id+'"]').value,assigned=$('salesRows').querySelector('[data-owner="'+id+'"]').value.trim()||null;
    if(assigned&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assigned)){alert('Enter a valid Supabase Auth UUID or leave assignment blank.');return}
    const {error}=await db.from('seller_leads').update({lead_status:status,priority,assigned_to:assigned,updated_at:new Date().toISOString()}).eq('id',id);
    if(error){alert('Save failed: '+error.message);return}await load();
  }
  const norm=v=>String(v||'').trim().toLowerCase();
  function mapHeaders(headers){const aliases={company_name:['company_name','business_name','company','seller_name','name'],source_marketplace:['source_marketplace','source','platform','marketplace'],source_url:['source_url','website','url','instagram','profile_url'],category:['category','product_category'],city:['city','town'],state:['state','region'],public_contact_name:['public_contact_name','contact_name','owner_name'],public_contact_phone:['public_contact_phone','phone','mobile','whatsapp','phone_number'],public_contact_email:['public_contact_email','email','email_address'],notes:['notes','remarks','status_notes'],priority:['priority']};const out={};for(const [key,names] of Object.entries(aliases))out[key]=headers.findIndex(h=>names.includes(norm(h).replace(/[\s-]+/g,'_')));return out}
  async function importCsv(){
    const f=$('salesCsv').files?.[0],note=$('salesNotice');if(!f){note.textContent='Choose a CSV file first.';return}if(f.size>10*1024*1024){note.textContent='File exceeds 10 MB limit.';return}
    const rows=csvRows(await f.text());if(rows.length<2){note.textContent='CSV has no data rows.';return}
    const m=mapHeaders(rows[0]);if(m.company_name<0||m.source_marketplace<0){note.textContent='Required columns missing: company_name/business_name and source_marketplace/source.';return}
    const {data:sessionData}=await db.auth.getSession(),user=sessionData?.session?.user;if(!user){note.textContent='CRM session expired; sign in again.';return}
    const existingKeys=new Set(leads.flatMap(x=>[x.source_url&&'url:'+norm(x.source_url),x.public_contact_phone&&'phone:'+norm(x.public_contact_phone).replace(/\D/g,''),x.public_contact_email&&'email:'+norm(x.public_contact_email),'name:'+norm(x.company_name)].filter(Boolean)));
    const seen=new Set(),payload=[];let skipped=0,invalid=0;
    for(const row of rows.slice(1)){const val=k=>m[k]>=0?String(row[m[k]]||'').trim():'';const name=val('company_name'),source=val('source_marketplace');if(!name||!source){invalid++;continue}
      const obj={company_name:name,source_marketplace:source,source_url:val('source_url')||null,category:val('category')||null,city:val('city')||null,state:val('state')||null,public_contact_name:val('public_contact_name')||null,public_contact_phone:val('public_contact_phone')||null,public_contact_email:val('public_contact_email')||null,notes:val('notes')||null,priority:['low','medium','high'].includes(norm(val('priority')))?norm(val('priority')):'medium',lead_status:'new'};
      const keys=['url:'+norm(obj.source_url),'phone:'+norm(obj.public_contact_phone).replace(/\D/g,''),'email:'+norm(obj.public_contact_email),'name:'+norm(name)].filter(k=>!k.endsWith(':'));
      if(keys.some(k=>existingKeys.has(k)||seen.has(k))){skipped++;continue}keys.forEach(k=>seen.add(k));payload.push(obj);
    }
    if(!payload.length){note.textContent='Nothing imported. '+skipped+' duplicate(s), '+invalid+' invalid row(s).';return}
    let inserted=0;for(let i=0;i<payload.length;i+=100){const {error}=await db.from('seller_leads').insert(payload.slice(i,i+100));if(error){note.textContent='Import stopped after '+inserted+' rows: '+error.message+'. '+skipped+' duplicates skipped; review permissions/schema before retrying.';await load();return}inserted+=Math.min(100,payload.length-i)}
    note.textContent='Imported '+inserted+' lead(s); skipped '+skipped+' duplicate(s), '+invalid+' invalid row(s). No messages sent.';await load();
  }
  async function saveActivity(e){
    e.preventDefault();const leadId=$('salesActivityLead').value.trim(),summary=$('salesActivitySummary').value.trim(),type=$('salesActivityType').value,follow=$('salesActivityDate').value;
    if(!leads.some(x=>String(x.id)===leadId)){alert('Choose a valid lead using Log activity, or enter an existing lead ID.');return}
    const {data:s}=await db.auth.getSession(),user=s?.session?.user;if(!user){alert('Sign in again.');return}
    const row=leads.find(x=>String(x.id)===leadId);
    const activity={activity_type:type,summary,outcome:null,follow_up_at:follow?new Date(follow).toISOString():null,created_by:user.id};
    const {error}=await db.from('crm_sales_activities').insert({...activity,account_id:null,deal_id:null});
    if(error){alert('Activity table rejected the record: '+error.message+'. This may need a schema/RLS fix in non-production.');return}
    const {error:updateError}=await db.from('seller_leads').update({lead_status:row.lead_status==='new'?'contacted':row.lead_status,contacted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',leadId);
    if(updateError)alert('Activity saved, but lead status update failed: '+updateError.message);
    $('salesActivitySummary').value='';$('salesActivityDate').value='';await load();alert('Activity saved. No message was sent.');
  }
  document.addEventListener('ff-crm-ready',()=>{if(['sales','marketing','administrator'].includes(role()))mount()});
  if(document.getElementById('dashboard')?.dataset.adminReady==='true'&&['sales','marketing','administrator'].includes(role()))mount();
})();
'use strict';
(function(){
  const db=window.supabaseClient;
  if(!db)return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses=['new','shortlisted','contacted','interested','onboarding','converted','not_interested','invalid'];
  const priorities=['high','medium','low'];
  let rows=[],filterStatus='all',searchTerm='',editing=null;
  function style(){
    if($('ffCrmStyle'))return;
    const s=document.createElement('style');s.id='ffCrmStyle';
    s.textContent='.ff-crm{margin-top:22px}.ff-crm .card-body{padding:18px}.ff-crm-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.ff-crm-toolbar input,.ff-crm-toolbar select,.ff-crm-form input,.ff-crm-form select,.ff-crm-form textarea{padding:10px;border:1px solid #d0d5dd;border-radius:7px;min-width:0}.ff-crm-toolbar input{flex:1;min-width:180px}.ff-crm-table-wrap{overflow:auto}.ff-crm table{min-width:850px}.ff-crm td{vertical-align:top}.ff-crm .ff-crm-muted{color:#667085;font-size:12px}.ff-crm .ff-crm-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:16px;padding:14px;background:#f8fafc;border:1px solid #e4e7ec;border-radius:10px}.ff-crm-form label{display:grid;gap:5px;font-size:12px;font-weight:700}.ff-crm-form .wide{grid-column:1/-1}.ff-crm-form textarea{min-height:70px}.ff-crm-status{font-size:12px;font-weight:700}.ff-crm-status.err{color:#b42318}.ff-crm-status.ok{color:#067647}.ff-crm .ff-crm-actions{display:flex;gap:5px;flex-wrap:wrap}.ff-crm .ff-crm-actions button{padding:6px 8px}.ff-crm-summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}.ff-crm-summary span{background:#f2f4f7;border-radius:8px;padding:8px 10px;font-size:12px}.ff-crm-summary b{font-size:15px;margin-left:4px}@media(max-width:700px){.ff-crm-form{grid-template-columns:1fr}.ff-crm-form .wide{grid-column:auto}}';
    document.head.appendChild(s);
  }
  function mount(){
    const dash=$('dashboard'),container=dash?.querySelector('.container');
    if(!container||$('ffCrm'))return;
    style();
    const sec=document.createElement('section');sec.id='ffCrm';sec.className='ff-crm card';
    sec.innerHTML='<div class="card-header"><div><h2>Seller Acquisition CRM</h2><p>Manage the existing seller lead pool and onboarding pipeline.</p></div><div><button class="secondary" id="ffCrmExport">Export CSV</button> <button class="primary" id="ffCrmNew">+ Add Lead</button></div></div><div class="card-body"><div id="ffCrmSummary" class="ff-crm-summary"></div><div id="ffCrmFormHost"></div><div class="ff-crm-toolbar"><input id="ffCrmSearch" type="search" placeholder="Search company, contact, city, category or source"><select id="ffCrmStatus"><option value="all">All statuses</option>'+statuses.map(s=>'<option value="'+s+'">'+s.replaceAll('_',' ')+'</option>').join('')+'</select><select id="ffCrmPriority"><option value="all">All priorities</option>'+priorities.map(s=>'<option value="'+s+'">'+s+'</option>').join('')+'</select><button class="secondary" id="ffCrmRefresh">Refresh</button></div><p id="ffCrmMessage" class="ff-crm-status" role="status"></p><div id="ffCrmRows" class="ff-crm-table-wrap">Loading leads…</div></div>';
    container.appendChild(sec);
    $('ffCrmNew').onclick=()=>showForm(null);
    $('ffCrmRefresh').onclick=load;
    $('ffCrmExport').onclick=exportCsv;
    $('ffCrmStatus').onchange=e=>{filterStatus=e.target.value;render()};
    $('ffCrmPriority').onchange=render;
    let timer;$('ffCrmSearch').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{searchTerm=e.target.value.trim().toLowerCase();render()},180)};
    load();
  }
  function safeHttpUrl(value){try{const u=new URL(String(value||''));return u.protocol==='https:'||u.protocol==='http:'?u.href:''}catch{return ''}}
  function message(text,type=''){const el=$('ffCrmMessage');if(el){el.textContent=text;el.className='ff-crm-status '+type}}
  function showForm(row){
    editing=row||null;
    const host=$('ffCrmFormHost');
    host.innerHTML='<form id="ffCrmForm" class="ff-crm-form"><label>Company / Business name<input name="company_name" required maxlength="200"></label><label>Contact person<input name="public_contact_name" maxlength="160"></label><label>Business type<input name="business_type" maxlength="100" placeholder="Manufacturer / Wholesaler / Retailer"></label><label>Source<input name="source_marketplace" required maxlength="120" placeholder="Directory / Referral / Instagram"></label><label>Source URL<input name="source_url" type="url" maxlength="1000"></label><label>Category<input name="category" maxlength="120"></label><label>City<input name="city" maxlength="100"></label><label>State<input name="state" maxlength="100"></label><label>GSTIN (if publicly provided)<input name="gstin" maxlength="20" autocomplete="off"></label><label>Contact method<input name="contact_method" maxlength="80" placeholder="public_phone / email / platform_inquiry"></label><label>Status<select name="lead_status">'+statuses.map(s=>'<option value="'+s+'">'+s.replaceAll('_',' ')+'</option>').join('')+'</select></label><label>Priority<select name="priority">'+priorities.map(s=>'<option value="'+s+'">'+s+'</option>').join('')+'</select></label><label class="wide">Notes<textarea name="notes" maxlength="4000" placeholder="Business context and follow-up notes. Do not enter passwords, OTPs, or payment secrets."></textarea></label><div class="wide"><button class="primary" type="submit">'+(row?'Save changes':'Create lead')+'</button> <button class="secondary" id="ffCrmCancel" type="button">Cancel</button></div></form>';
    const form=$('ffCrmForm');
    if(row)for(const [key,value] of Object.entries(row)){const field=form.elements.namedItem(key);if(field&&value!=null)field.value=value}
    $('ffCrmCancel').onclick=()=>{host.innerHTML='';editing=null};
    form.onsubmit=save;
    host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function save(e){
    e.preventDefault();const form=e.currentTarget,btn=form.querySelector('[type=submit]');btn.disabled=true;
    const value=name=>String(form.elements.namedItem(name)?.value||'').trim();
    const payload={company_name:value('company_name'),public_contact_name:value('public_contact_name')||null,business_type:value('business_type')||null,source_marketplace:value('source_marketplace'),source_url:value('source_url')||null,category:value('category')||null,city:value('city')||null,state:value('state')||null,gstin:value('gstin')||null,contact_method:value('contact_method')||'platform_inquiry',lead_status:value('lead_status'),priority:value('priority'),notes:value('notes')||null,updated_at:new Date().toISOString()};
    try{
      const query=editing?db.from('seller_leads').update(payload).eq('id',editing.id):db.from('seller_leads').insert(payload);
      const{error}=await query;if(error)throw error;
      message(editing?'Lead updated.':'Lead created.','ok');$('ffCrmFormHost').innerHTML='';editing=null;await load();
    }catch(err){message(err.message||'Lead could not be saved.','err')}
    finally{btn.disabled=false}
  }
  async function setStatus(id,status){
    const row=rows.find(x=>Number(x.id)===Number(id));if(!row)return;
    if(status==='converted'&&!row.converted_seller_id&&!confirm('Mark this lead converted? Confirm that seller onboarding has actually completed.'))return;
    try{const patch={lead_status:status,updated_at:new Date().toISOString()};if(status==='contacted')patch.contacted_at=row.contacted_at||new Date().toISOString();const{error}=await db.from('seller_leads').update(patch).eq('id',id);if(error)throw error;message('Lead status updated.','ok');await load()}catch(err){message(err.message||'Status update failed.','err')}
  }
  function render(){
    const priority=$('ffCrmPriority')?.value||'all';
    const data=rows.filter(r=>(filterStatus==='all'||r.lead_status===filterStatus)&&(priority==='all'||r.priority===priority)&&(!searchTerm||[r.company_name,r.public_contact_name,r.city,r.state,r.category,r.source_marketplace,r.business_type].some(v=>String(v||'').toLowerCase().includes(searchTerm))));
    const counts=statuses.map(s=>[s,rows.filter(r=>r.lead_status===s).length]).filter(x=>x[1]);
    $('ffCrmSummary').innerHTML='<span>Total leads <b>'+rows.length+'</b></span>'+counts.map(([s,n])=>'<span>'+esc(s.replaceAll('_',' '))+' <b>'+n+'</b></span>').join('');
    const box=$('ffCrmRows');
    if(!data.length){box.innerHTML='<p>No leads match these filters.</p>';return}
    box.innerHTML='<table><thead><tr><th>Business</th><th>Location / Category</th><th>Source</th><th>Status</th><th>Priority</th><th>Last contact</th><th>Actions</th></tr></thead><tbody>'+data.map(r=>'<tr><td><b>'+esc(r.company_name)+'</b><div class="ff-crm-muted">'+esc(r.public_contact_name||'No contact name')+'</div><div class="ff-crm-muted">'+esc(r.business_type||'')+'</div></td><td>'+esc([r.city,r.state].filter(Boolean).join(', ')||'—')+'<div class="ff-crm-muted">'+esc(r.category||'')+'</div></td><td>'+esc(r.source_marketplace)+'<div class="ff-crm-muted">'+(safeHttpUrl(r.source_url)?'<a href="'+esc(safeHttpUrl(r.source_url))+'" target="_blank" rel="noopener noreferrer">Open source</a>':'')+'</div></td><td><select data-status="'+r.id+'" aria-label="Lead status">'+statuses.map(s=>'<option value="'+s+'" '+(s===r.lead_status?'selected':'')+'>'+s.replaceAll('_',' ')+'</option>').join('')+'</select></td><td><select data-priority="'+r.id+'" aria-label="Lead priority">'+priorities.map(s=>'<option value="'+s+'" '+(s===r.priority?'selected':'')+'>'+s+'</option>').join('')+'</select></td><td>'+esc(r.contacted_at?new Date(r.contacted_at).toLocaleDateString('en-IN'):'Not contacted')+'</td><td><div class="ff-crm-actions"><button class="secondary" data-edit="'+r.id+'">Edit</button><button class="secondary" data-contact="'+r.id+'">Mark contacted</button></div></td></tr>').join('')+'</tbody></table>';
    box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>showForm(rows.find(r=>Number(r.id)===Number(b.dataset.edit))));
    box.querySelectorAll('[data-status]').forEach(s=>s.onchange=()=>setStatus(s.dataset.status,s.value));
    box.querySelectorAll('[data-priority]').forEach(s=>s.onchange=async()=>{try{const{error}=await db.from('seller_leads').update({priority:s.value,updated_at:new Date().toISOString()}).eq('id',s.dataset.priority);if(error)throw error;await load();message('Priority updated.','ok')}catch(e){message(e.message||'Priority update failed.','err')}});
    box.querySelectorAll('[data-contact]').forEach(b=>b.onclick=()=>setStatus(b.dataset.contact,'contacted'));
  }
  async function load(){
    const box=$('ffCrmRows');if(box)box.textContent='Loading leads…';
    try{const{data,error}=await db.from('seller_leads').select('id,company_name,source_marketplace,source_url,category,city,state,business_type,gstin,public_contact_name,contact_method,lead_status,priority,notes,source_checked_at,contacted_at,converted_seller_id,created_at,updated_at').order('updated_at',{ascending:false}).limit(1000);if(error)throw error;rows=data||[];render()}
    catch(err){if(box)box.innerHTML='<p class="status show err">'+esc(err.message||'Could not load seller leads.')+'</p>';message('Lead data is unavailable. Verify admin access and seller_leads policies.','err')}
  }
  function exportCsv(){
    const cols=['id','company_name','public_contact_name','business_type','source_marketplace','source_url','category','city','state','gstin','contact_method','lead_status','priority','notes','contacted_at','created_at','updated_at'];
    const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
    const csv=[cols.join(','),...rows.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download='fashion-fussion-seller-leads.csv';a.click();URL.revokeObjectURL(url);
  }
  function init(){const dash=$('dashboard');if(!dash)return;if(dash.dataset.adminReady==='true'){mount();return}const obs=new MutationObserver(()=>{if(dash.dataset.adminReady==='true'){obs.disconnect();mount()}});obs.observe(dash,{attributes:true,attributeFilter:['data-admin-ready']})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
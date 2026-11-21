(function(){
'use strict';
const client=window.supabaseClient;
if(!client)return;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let rows=[],busy=false;
function statusClass(v){return v==='verified'?'verified':v==='changes_requested'?'rejected':'pending_review'}
function statusText(v){return v==='changes_requested'?'Changes requested':String(v||'pending review').replaceAll('_',' ')}
function mount(){
 const dash=$('dashboard'),container=dash?.querySelector('.container');
 if(!container)return false;
 if($('ffCustomerBankReview'))return true;
 const section=document.createElement('section');
 section.id='ffCustomerBankReview';section.className='card';
 section.innerHTML='<div class="card-header"><div><h2>Customer business bank review</h2><p style="margin:5px 0 0;color:#667085;font-size:12px">Business &amp; Bulk bank accounts only. Manual review is used until automatic verification is available. Full account numbers are visible only to authorized admins and included in the export.</p></div><div class="ff-customer-bank-tools"><select id="ffCustomerBankStatus"><option value="">All reviews</option><option value="pending_review">Pending review</option><option value="verified">Verified</option><option value="changes_requested">Changes requested</option></select><input id="ffCustomerBankSearch" placeholder="Customer, email, business or bank"><button class="secondary" id="ffCustomerBankRefresh" type="button">↻ Refresh</button><button class="secondary" id="ffCustomerBankExport" type="button">Export Excel CSV</button></div></div><div class="card-body"><div id="ffCustomerBankSummary" class="status show ok" style="display:block"></div><div class="table-wrapper"><table class="ff-customer-bank-table"><thead><tr><th>Customer / business</th><th>Action</th><th>Account holder / bank</th><th>Account</th><th>IFSC</th><th>Submitted status</th><th>Admin review</th></tr></thead><tbody id="ffCustomerBankRows"></tbody></table></div></div>';
 const style=document.createElement('style');style.textContent='#ffCustomerBankReview{margin-top:20px}.ff-customer-bank-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ff-customer-bank-tools input,.ff-customer-bank-tools select{border:1px solid #d9dde5;border-radius:8px;padding:8px 10px}.ff-customer-bank-table{width:100%;min-width:900px;border-collapse:collapse;font-size:12px}.ff-customer-bank-table th,.ff-customer-bank-table td{padding:10px 8px;border-bottom:1px solid #eceef2;text-align:left;vertical-align:top}.ff-customer-bank-table th{background:#f8fafc}.ff-customer-bank-table small{display:block;color:#667085;margin-top:4px}.ff-customer-bank-pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#fff4d6;color:#8a5a00;font-size:11px;font-weight:700;text-transform:capitalize}.ff-customer-bank-pill.verified{background:#e9f8ef;color:#18794e}.ff-customer-bank-pill.rejected{background:#fff0f0;color:#b42318}.ff-customer-bank-actions{display:flex;gap:6px;flex-wrap:wrap}.ff-customer-bank-reason{color:#b42318!important}';document.head.appendChild(style);
 const anchor=$('adminSellerFinancePanel');
 if(anchor)anchor.insertAdjacentElement('afterend',section);else container.appendChild(section);
 $('ffCustomerBankRefresh').onclick=load;$('ffCustomerBankExport').onclick=exportCsv;
 $('ffCustomerBankStatus').onchange=load;
 $('ffCustomerBankSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load()}};
 return true
}
async function load(){
 if(busy||!mount())return;
 busy=true;$('ffCustomerBankSummary').textContent='Loading customer bank reviews…';
 try{
  const{data,error}=await client.rpc('admin_list_customer_bank_reviews',{p_status:$('ffCustomerBankStatus').value||null,p_search:$('ffCustomerBankSearch').value.trim()||null,p_limit:200});
  if(error)throw error;
  const{data:sensitive,error:sensitiveError}=await client.rpc('admin_list_customer_bank_sensitive_details',{p_status:$('ffCustomerBankStatus').value||null,p_search:$('ffCustomerBankSearch').value.trim()||null,p_limit:200});if(sensitiveError)throw sensitiveError;const sensitiveMap=new Map((Array.isArray(sensitive)?sensitive:[]).map(x=>[String(x.customer_id),x.account_number]));rows=(Array.isArray(data)?data:[]).map(r=>({...r,full_account_number:sensitiveMap.get(String(r.customer_id))||null}));
  render()
 }catch(e){$('ffCustomerBankSummary').textContent='Customer bank reviews could not be loaded: '+(e.message||'Unknown error');$('ffCustomerBankSummary').className='status show err'}
 finally{busy=false}
}
function render(){
 const pending=rows.filter(r=>r.admin_review_status==='pending_review').length;
 const changes=rows.filter(r=>r.admin_review_status==='changes_requested').length;
 $('ffCustomerBankSummary').textContent=rows.length+' customer bank profile'+(rows.length===1?'':'s')+' · '+pending+' pending review · '+changes+' awaiting customer changes';
 $('ffCustomerBankRows').innerHTML=rows.length?rows.map(r=>{
  const status=r.admin_review_status||'pending_review';
  let actions='';
  if(status==='pending_review')actions='<div class="ff-customer-bank-actions"><button class="primary" data-customer-bank-review="verified" data-id="'+esc(r.customer_id)+'">Mark verified</button><button class="secondary" data-customer-bank-review="changes_requested" data-id="'+esc(r.customer_id)+'">Request changes</button></div>';
  else if(status==='changes_requested')actions='<span>Awaiting customer updates</span>';
  else if(status==='verified')actions='<div class="ff-customer-bank-actions"><span>Verified by admin</span><button class="secondary" data-customer-bank-review="changes_requested" data-id="'+esc(r.customer_id)+'">Mark not verified / request changes</button></div>';
  else actions='<span>Changes requested</span>';
  const reason=status==='changes_requested'&&r.admin_review_reason?'<small class="ff-customer-bank-reason">Reason: '+esc(r.admin_review_reason)+'</small>':'';
  return '<tr><td><b>'+esc(r.full_name||'Customer')+'</b><small>'+esc(r.email||'')+'</small><small>'+esc(r.business_name||'Business profile')+'</small></td><td>'+actions+'</td><td>'+esc(r.account_holder_name||'—')+'<small>'+esc(r.bank_name||'—')+'</small></td><td>'+esc(r.full_account_number||'Re-submit required')+'</td><td>'+esc(r.ifsc||'—')+'</td><td><span class="ff-customer-bank-pill '+statusClass(r.verification_status)+'">'+esc(statusText(r.verification_status))+'</span></td><td><span class="ff-customer-bank-pill '+statusClass(status)+'">'+esc(statusText(status))+'</span>'+reason+'</td></tr>'
 }).join(''):'<tr><td colspan="7">No customer bank profiles match this review filter.</td></tr>';
 $('ffCustomerBankRows').querySelectorAll('[data-customer-bank-review]').forEach(b=>b.onclick=()=>review(b.dataset.id,b.dataset.customerBankReview))
}
function csvCell(v){let s=String(v??'').replace(/\r?\n/g,' ').trim();if(/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
function exportCsv(){if(!rows.length){alert('No customer bank reviews to export.');return}const data=[['Customer','Email','Business','Account Holder','Bank','Account Number (full)','IFSC','Submitted Status','Admin Review','Review Reason'].map(csvCell).join(',')];for(const r of rows)data.push([r.full_name||'Customer',r.email||'',r.business_name||'',r.account_holder_name||'',r.bank_name||'',r.full_account_number||'Re-submit required',r.ifsc||'',statusText(r.verification_status),statusText(r.admin_review_status),r.admin_review_reason||''].map(csvCell).join(','));const blob=new Blob(['\uFEFF'+data.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fashion-fussion-customer-bank-reviews-'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function review(customerId,decision){
 if(busy)return;
 let reason=null;
 if(decision==='changes_requested'){
  reason=prompt('Tell the customer what they need to change:','');
  if(reason===null)return;
  reason=reason.trim();
  if(!reason||reason.length>500){alert('Enter a reason of 1 to 500 characters.');return}
 }else if(!confirm('Mark this customer business bank profile verified by admin?'))return;
 busy=true;
 try{
  const{error}=await client.rpc('admin_review_customer_bank',{p_customer_id:customerId,p_decision:decision,p_reason:reason});
  if(error)throw error;
  await load()
 }catch(e){alert(e.message||'Customer bank review failed.')}
 finally{busy=false}
}
function init(){
 const dash=$('dashboard');if(!dash)return;
 if(dash.dataset.adminReady==='true'){load();return}
 const observer=new MutationObserver(()=>{if(dash.dataset.adminReady==='true'){observer.disconnect();load()}});
 observer.observe(dash,{attributes:true,attributeFilter:['data-admin-ready']})
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
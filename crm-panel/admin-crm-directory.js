'use strict';
(function(){
  const db=window.supabaseClient;if(!db)return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let orders=[],sellers=[],term='';
  const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  const date=v=>v?new Date(v).toLocaleDateString('en-IN'):'—';
  function mount(){
    const dash=$('dashboard'),container=dash?.querySelector('.container');if(!container||$('ffCrmDirectory'))return;
    const sec=document.createElement('section');sec.id='ffCrmDirectory';sec.className='card ff-crm-dir';
    sec.innerHTML='<div class="card-header"><div><h2>Customer & Seller 360°</h2><p>Read-only directory view. Customer history uses recent order snapshots; seller profiles are shown separately.</p></div><button class="secondary" id="ffCrmDirRefresh" type="button">Refresh data</button></div><div class="card-body"><div class="ff-crm-dir-stats" id="ffCrmDirStats"></div><label class="ff-crm-dir-search">Search customers or sellers<input id="ffCrmDirSearch" type="search" placeholder="Name, email, phone, seller code or store"></label><div class="ff-crm-dir-grid"><section><h3>Customers from orders</h3><p class="ff-crm-dir-note">Latest 1,000 order records; no order or payment state can be changed here.</p><div class="ff-crm-dir-table" id="ffCrmCustomers">Loading customer history…</div></section><section><h3>Seller directory</h3><p class="ff-crm-dir-note">Seller profile details and current onboarding status.</p><div class="ff-crm-dir-table" id="ffCrmSellers">Loading seller profiles…</div></section></div><p id="ffCrmDirMessage" role="status"></p></div>';
    const style=document.createElement('style');style.textContent='#ffCrmDirectory{margin-top:20px}#ffCrmDirectory .ff-crm-dir-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}#ffCrmDirectory .ff-crm-dir-stats span{background:#f2f4f7;border-radius:8px;padding:9px 12px;font-size:12px}#ffCrmDirectory .ff-crm-dir-stats b{display:block;font-size:18px}#ffCrmDirectory .ff-crm-dir-search{display:grid;gap:6px;max-width:620px;font-size:13px;font-weight:700;margin-bottom:18px}#ffCrmDirectory input{padding:10px;border:1px solid #d0d5dd;border-radius:7px}#ffCrmDirectory .ff-crm-dir-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}#ffCrmDirectory .ff-crm-dir-grid section{min-width:0}#ffCrmDirectory .ff-crm-dir-table{overflow:auto;max-height:560px}#ffCrmDirectory table{width:100%;min-width:460px;border-collapse:collapse;font-size:12px}#ffCrmDirectory th,#ffCrmDirectory td{padding:9px 8px;border-bottom:1px solid #eaecf0;text-align:left;vertical-align:top}#ffCrmDirectory th{position:sticky;top:0;background:#f8fafc}#ffCrmDirectory .ff-crm-dir-note{color:#667085;font-size:12px;line-height:1.45}@media(max-width:800px){#ffCrmDirectory .ff-crm-dir-grid{grid-template-columns:1fr}}';document.head.appendChild(style);
    container.appendChild(sec);$('ffCrmDirRefresh').onclick=load;$('ffCrmDirSearch').oninput=e=>{term=e.target.value.trim().toLowerCase();render()};load();
  }
  async function load(){
    const c=$('ffCrmCustomers'),s=$('ffCrmSellers');if(c)c.textContent='Loading customer history…';if(s)s.textContent='Loading seller profiles…';
    try{
      const results=await Promise.all([
        db.from('orders').select('id,user_id,total_amount,currency,status,customer_name,customer_email,customer_phone,created_at,fulfillment_status,payment_method').order('created_at',{ascending:false}).limit(1000),
        db.from('seller_profiles').select('user_id,store_name,seller_type,phone,status,seller_code,created_at,updated_at').order('created_at',{ascending:false}).limit(1000)
      ]);
      if(results[0].error)throw new Error('Customer order history: '+results[0].error.message);
      if(results[1].error)throw new Error('Seller directory: '+results[1].error.message);
      orders=results[0].data||[];sellers=results[1].data||[];render();
      $('ffCrmDirMessage').textContent='Read-only data loaded. Customer records are grouped from the latest 1,000 orders; seller profiles are capped at 1,000 rows.';
    }catch(e){if(c)c.textContent='Customer history unavailable. Check admin access.';if(s)s.textContent='Seller directory unavailable. Check admin access.';$('ffCrmDirMessage').textContent=e.message||'CRM directory could not be loaded.'}
  }
  function customers(){
    const map=new Map();
    for(const o of orders){
      const email=String(o.customer_email||'').trim().toLowerCase(),phone=String(o.customer_phone||'').trim();
      const key=o.user_id?'user:'+o.user_id:(email?'email:'+email:(phone?'phone:'+phone:'order:'+o.id));
      if(!map.has(key))map.set(key,{key,name:o.customer_name||'Customer',email:o.customer_email||'',phone:o.customer_phone||'',userId:o.user_id||'',orders:[],value:0,last:o.created_at});
      const c=map.get(key);c.orders.push(o);c.value+=Number(o.total_amount||0);if(!c.name&&o.customer_name)c.name=o.customer_name;
    }
    return [...map.values()].sort((a,b)=>new Date(b.last||0)-new Date(a.last||0));
  }
  function render(){
    const cs=customers(),filter=x=>[x.name,x.email,x.phone,x.userId].some(v=>String(v||'').toLowerCase().includes(term));
    const filteredC=cs.filter(filter),filteredS=sellers.filter(x=>[x.store_name,x.seller_type,x.phone,x.status,x.seller_code,x.user_id].some(v=>String(v||'').toLowerCase().includes(term)));
    $('ffCrmDirStats').innerHTML='<span><b>'+cs.length+'</b>Customer profiles from recent orders</span><span><b>'+orders.length+'</b>Orders scanned</span><span><b>'+sellers.length+'</b>Seller profiles</span><span><b>'+money(orders.reduce((n,o)=>n+Number(o.total_amount||0),0))+'</b>Order value in scanned window</span>';
    $('ffCrmCustomers').innerHTML=filteredC.length?'<table><thead><tr><th>Customer</th><th>Orders / Value</th><th>Last order</th><th>Latest status</th></tr></thead><tbody>'+filteredC.map(c=>'<tr><td><b>'+esc(c.name)+'</b><div>'+esc(c.email)+'</div><div>'+esc(c.phone)+'</div></td><td>'+c.orders.length+' / '+money(c.value)+'</td><td>'+date(c.last)+'</td><td>'+esc(c.orders[0]?.status||'—')+'<div>'+esc(c.orders[0]?.fulfillment_status||'')+'</div></td></tr>').join('')+'</tbody></table>':'<p>No matching customer records.</p>';
    $('ffCrmSellers').innerHTML=filteredS.length?'<table><thead><tr><th>Seller / Code</th><th>Type / Status</th><th>Phone</th><th>Joined</th></tr></thead><tbody>'+filteredS.map(s=>'<tr><td><b>'+esc(s.store_name||'Unnamed seller')+'</b><div>'+esc(s.seller_code||'')+'</div><div class="ff-crm-dir-note">User ID: '+esc(s.user_id||'—')+'</div></td><td>'+esc(s.seller_type||'—')+'<div>'+esc(s.status||'—')+'</div></td><td>'+esc(s.phone||'—')+'</td><td>'+date(s.created_at)+'</td></tr>').join('')+'</tbody></table>':'<p>No matching seller records.</p>';
  }
  function init(){const d=$('dashboard');if(!d)return;if(d.dataset.adminReady==='true'){mount();return}const o=new MutationObserver(()=>{if(d.dataset.adminReady==='true'){o.disconnect();mount()}});o.observe(d,{attributes:true,attributeFilter:['data-admin-ready']})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

(function(){
'use strict';
const CATEGORY_MAP={
  'Customers':'Customers','Business customers':'Customers',
  'Sellers':'Sellers','Active sellers':'Sellers',
  'Active products':'Catalog & Inventory','Available stock':'Catalog & Inventory',
  'Orders (all)':'Orders','Order value (non-cancelled)':'Orders','Cancelled orders':'Orders',
  'Open returns':'Returns & Payments','Open payment exceptions':'Returns & Payments',
  'Customer tickets open':'Support','Seller tickets open':'Support','SLA overdue':'Support',
  'Shipments':'Shipping','Open B2B quotes':'B2B','Outstanding gift balance':'Promotions'
};
function csvCell(v){let s=String(v??'').replace(/\r?\n/g,' ').trim();if(/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
function download(rows){const text='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');const blob=new Blob([text],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='fashion-fussion-business-overview-'+new Date().toISOString().slice(0,10)+'.csv';a.hidden=true;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function enhance(){
  const grid=document.querySelector('#ffOwnerBody .ff-owner-grid');
  if(!grid||grid.dataset.overviewSheet==='true')return;
  const cards=[...grid.querySelectorAll('.ff-owner-card')];
  if(!cards.length)return;
  const rows=cards.map((card,index)=>{
    const metric=(card.querySelector('span')?.textContent||'').trim();
    const value=(card.querySelector('b')?.textContent||'0').trim();
    return {index:index+1,category:CATEGORY_MAP[metric]||'Other',metric,value};
  });
  grid.dataset.overviewSheet='true';
  grid.className='ff-owner-overview-sheet-wrap';
  grid.innerHTML='<div class="ff-owner-overview-toolbar"><div><b>Business summary</b><small>Excel-friendly overview of current business metrics</small></div><button class="secondary" type="button" data-overview-export>Export Overview CSV</button></div><div class="ff-owner-sheet ff-owner-overview-sheet" role="region" aria-label="Business overview spreadsheet" tabindex="0"><table class="ff-owner-table"><thead><tr><th>#</th><th>Category</th><th>Metric</th><th>Value</th></tr></thead><tbody>'+rows.map(r=>'<tr><td class="rownum">'+r.index+'</td><td><span class="ff-owner-status">'+escapeHtml(r.category)+'</span></td><td><b>'+escapeHtml(r.metric)+'</b></td><td class="num"><b>'+escapeHtml(r.value)+'</b></td></tr>').join('')+'</tbody></table></div>';
  grid.querySelector('[data-overview-export]')?.addEventListener('click',()=>download([['Category','Metric','Value'],...rows.map(r=>[r.category,r.metric,r.value])]));
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function boot(){enhance();const target=document.getElementById('ffOwnerBody')||document.body;new MutationObserver(enhance).observe(target,{childList:true,subtree:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

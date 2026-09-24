(function(){
'use strict';
const AREA_META={
  dashboard:['Dashboard','Business snapshot, exceptions and the next actions that need attention.'],
  orders:['Orders','Order flow, payment state and fulfillment operations.'],
  catalog:['Catalog','Products, pricing, GST and sellable catalog controls.'],
  inventory:['Inventory','SKU variants, available stock and reorder controls.'],
  finance:['Finance','Payment exceptions, seller settlements and payout operations.'],
  returns:['Returns','Returns, exchanges and refund review workflow.'],
  shipping:['Shipping','Courier readiness, shipment creation and delivery operations.'],
  customers:['Customers','Customer directory, order value and customer-level exports.'],
  sellers:['Sellers','Seller directory, product activity and seller operations.'],
  support:['Support','Customer and seller support queues, SLA and ticket handling.'],
  growth:['B2B & Growth','Business quotes and promotional operations.'],
  tools:['System Tools','Operational health, launch readiness and recovery controls.']
};
const VALID=new Set(Object.keys(AREA_META));
let container,shell,content,home,statusSlot,active='dashboard',observer,dashboardBusy=false;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
function safeStoredArea(){try{const v=sessionStorage.getItem('ff_admin_business_area');return VALID.has(v)?v:'dashboard'}catch{return'dashboard'}}
function storeArea(v){try{sessionStorage.setItem('ff_admin_business_area',v)}catch{}}
function navHtml(){return '<div class="ff-business-brand"><b>Business Control Center</b><span>Owner workspace</span></div><nav class="ff-business-nav" aria-label="Admin workspace navigation">'+
'<div class="ff-business-nav-group"><span class="ff-business-nav-label">Operate</span>'+navButton('dashboard','Dashboard')+navButton('orders','Orders')+navButton('catalog','Catalog')+navButton('inventory','Inventory')+navButton('finance','Finance')+navButton('returns','Returns')+navButton('shipping','Shipping')+'</div>'+ 
'<div class="ff-business-nav-group"><span class="ff-business-nav-label">Relationships</span>'+navButton('customers','Customers')+navButton('sellers','Sellers')+navButton('support','Support')+'</div>'+ 
'<div class="ff-business-nav-group"><span class="ff-business-nav-label">Business</span>'+navButton('growth','B2B & Growth')+navButton('tools','System Tools')+'</div></nav>'}
function navButton(area,label){return '<button type="button" data-business-nav="'+area+'"><span>'+label+'</span><span class="ff-nav-badge" data-nav-badge="'+area+'"></span></button>'}
function buildShell(){
  const dash=$('dashboard');container=dash?.querySelector('.container');if(!container||$('ffBusinessShell'))return;
  active=safeStoredArea();const previous=[...container.children];
  shell=document.createElement('div');shell.id='ffBusinessShell';shell.className='ff-business-shell';
  shell.innerHTML='<aside class="ff-business-sidebar">'+navHtml()+'</aside><div class="ff-business-main"><div class="ff-business-topbar"><div class="ff-business-title"><small>Fashion Fussion · Admin</small><h1 id="ffBusinessTitle">Dashboard</h1><p id="ffBusinessSubtitle"></p></div><div class="ff-business-top-actions"><button class="primary" id="ffBusinessPrimary" type="button" hidden>+ Add Product</button><button class="secondary" id="ffBusinessRefresh" type="button">↻ Refresh</button></div></div><div id="ffBusinessStatusSlot"></div><div id="ffDashboardHome" class="ff-dashboard-home"></div><div id="ffBusinessContent"></div></div>';
  container.insertBefore(shell,container.firstChild);content=$('ffBusinessContent');home=$('ffDashboardHome');statusSlot=$('ffBusinessStatusSlot');
  previous.forEach(adopt);
  shell.querySelectorAll('[data-business-nav]').forEach(b=>b.onclick=()=>setArea(b.dataset.businessNav));
  $('ffBusinessRefresh').onclick=refreshCurrent;$('ffBusinessPrimary').onclick=()=>$('addProductButton')?.click();
  home.addEventListener('click',e=>{const go=e.target.closest('[data-go-area]');if(go)setArea(go.dataset.goArea);const add=e.target.closest('[data-owner-add-product]');if(add){setArea('catalog');setTimeout(()=>$('addProductButton')?.click(),50)}});
  observer=new MutationObserver(records=>records.forEach(r=>[...r.addedNodes].forEach(n=>{if(n.nodeType===1&&n.parentElement===container&&n!==shell)adopt(n)})));
  observer.observe(container,{childList:true});
  setArea(active,false);loadDashboard();
}
function titleOf(node){return (node.querySelector?.('h2')?.textContent||node.querySelector?.('h1')?.textContent||'').trim().toLowerCase()}
function classify(node){
  if(node.id==='status')return'status';
  if(node.classList?.contains('page-title')||node.classList?.contains('stats'))return'catalog';
  const id=node.id||'';
  const exact={ffOrdersCard:'orders',ffPaymentReviewCard:'finance',ffReturnsCard:'returns',ffBusinessQuotesCard:'growth',ffInventoryCard:'inventory',ffShippingCard:'shipping',ffOwnerCenter:'owner',ffSellerFinanceCard:'finance',ffPromotionsCard:'growth',ffSellerApprovalsCard:'sellers',ffCheckoutHealthCard:'tools',ffLaunchReadinessCard:'tools',ffRecoveryStatusCard:'tools',ffShippingHealthCard:'shipping',ffCatalogSafetyCard:'catalog'};
  if(exact[id])return exact[id];
  const t=titleOf(node);
  if(t.includes('order management'))return'orders';
  if(t.includes('payment review')||t.includes('payout')||t.includes('settlement'))return'finance';
  if(t.includes('return')||t.includes('exchange'))return'returns';
  if(t.includes('business quote')||t.includes('promotion'))return'growth';
  if(t.includes('variant')||t.includes('inventory'))return'inventory';
  if(t.includes('shipping')||t.includes('shiprocket')||t.includes('courier'))return'shipping';
  if(t.includes('seller kyc'))return'finance';
  if(t.includes('seller approval')||t.includes('seller product'))return'sellers';
  if(t.includes('catalog')||t.includes('product management'))return'catalog';
  if(t.includes('owner operations'))return'owner';
  if(t.includes('checkout health')||t.includes('launch readiness')||t.includes('recovery'))return'tools';
  return'tools';
}
function adopt(node){
  if(!(node instanceof HTMLElement)||node===shell)return;
  const area=classify(node);
  if(area==='status'){statusSlot.appendChild(node);return}
  node.dataset.businessArea=area;content.appendChild(node);
  applyVisibility(node);
  if(area==='owner'&&['customers','sellers','support'].includes(active))activateOwnerTab(active);
}
function shouldShow(node){const area=node.dataset.businessArea;if(area==='owner')return['customers','sellers','support'].includes(active);return area===active}
function applyVisibility(node){if(node?.dataset?.businessArea)node.hidden=!shouldShow(node)}
function applyAll(){content?.querySelectorAll(':scope > [data-business-area]').forEach(applyVisibility);if(home)home.hidden=active!=='dashboard'}
function setArea(area,persist=true){
  if(!VALID.has(area))area='dashboard';active=area;if(persist)storeArea(area);
  shell?.querySelectorAll('[data-business-nav]').forEach(b=>b.classList.toggle('active',b.dataset.businessNav===area));
  const meta=AREA_META[area];if($('ffBusinessTitle'))$('ffBusinessTitle').textContent=meta[0];if($('ffBusinessSubtitle'))$('ffBusinessSubtitle').textContent=meta[1];
  const primary=$('ffBusinessPrimary');if(primary)primary.hidden=area!=='catalog';
  applyAll();
  if(['customers','sellers','support'].includes(area))activateOwnerTab(area);
  if(area==='dashboard')loadDashboard();
  window.scrollTo({top:0,behavior:'smooth'});
}
function activateOwnerTab(name,attempt=0){
  const center=$('ffOwnerCenter');const btn=center?.querySelector('[data-owner-tab="'+name+'"]');
  if(btn){btn.click();return}
  if(attempt<35)setTimeout(()=>activateOwnerTab(name,attempt+1),120);
}
function setBadge(area,value){const el=shell?.querySelector('[data-nav-badge="'+area+'"]');if(!el)return;const n=Number(value||0);el.textContent=n>99?'99+':String(n);el.classList.toggle('show',n>0)}
async function loadDashboard(){
  if(!home||dashboardBusy)return;dashboardBusy=true;
  home.innerHTML='<div class="ff-dashboard-section"><div class="ff-business-empty">Loading business snapshot…</div></div>';
  try{
    const supa=window.supabaseClient;if(!supa)throw new Error('Business data service is unavailable.');
    const{data,error}=await supa.rpc('owner_business_overview');if(error)throw error;const d=data||{};
    const openSupport=Number(d.support?.customer_open||0)+Number(d.support?.seller_open||0);
    const kpis=[
      ['Non-cancelled order value',money(d.orders?.order_value),'orders'],['Orders',d.orders?.total||0,'orders'],['Customers',d.customers?.total||0,'customers'],['Active sellers',d.sellers?.active||0,'sellers'],['Available stock',d.inventory?.available||0,'inventory'],['Active products',d.catalog?.active_products||0,'catalog']
    ];
    const attention=[
      ['Payment exceptions',Number(d.payments?.open_exceptions||0),'finance'],['Open returns',Number(d.returns?.open||0),'returns'],['Open support tickets',openSupport,'support'],['SLA overdue',Number(d.support?.overdue||0),'support']
    ];
    const issueCount=attention.reduce((a,x)=>a+x[1],0);
    home.innerHTML='<section class="ff-dashboard-section"><div class="ff-dashboard-section-head"><div><h2>Business snapshot</h2><p>High-level operating numbers. Drill into a workspace only when action is needed.</p></div><small>Updated '+esc(new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}))+'</small></div><div class="ff-owner-kpis">'+kpis.map(x=>'<div class="ff-owner-kpi"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b><button type="button" data-go-area="'+x[2]+'">Open '+esc(AREA_META[x[2]][0])+' →</button></div>').join('')+'</div></section>'+ 
    '<section class="ff-dashboard-section"><div class="ff-dashboard-section-head"><div><h2>Needs attention</h2><p>Exceptions that can block money, customers or operations.</p></div></div>'+(issueCount===0?'<div class="ff-all-clear">No open payment, return or support exceptions need attention right now.</div>':'<div class="ff-attention-grid">'+attention.map(x=>'<button class="ff-attention-card '+(x[1]>0?'has-issue':'')+'" type="button" data-go-area="'+x[2]+'"><span>'+esc(x[0])+'</span><b>'+x[1]+'</b></button>').join('')+'</div>')+'</section>'+ 
    '<section class="ff-dashboard-section"><div class="ff-dashboard-section-head"><div><h2>Quick actions</h2><p>Common owner actions without searching through the page.</p></div></div><div class="ff-dashboard-quick"><button type="button" data-go-area="orders">Review orders</button><button type="button" data-go-area="finance">Review finance</button><button type="button" data-go-area="support">Open support</button><button type="button" data-owner-add-product>Add product</button></div></section>';
    setBadge('finance',d.payments?.open_exceptions);setBadge('returns',d.returns?.open);setBadge('support',openSupport);setBadge('orders',0);
  }catch(e){home.innerHTML='<div class="ff-dashboard-section"><div class="status show err">'+esc(e.message||'Could not load business snapshot.')+'</div></div>'}
  finally{dashboardBusy=false}
}
function refreshCurrent(){
  if(active==='dashboard'){loadDashboard();return}
  if(['customers','sellers','support'].includes(active)){activateOwnerTab(active);return}
  const visible=[...content.querySelectorAll(':scope > [data-business-area="'+active+'"]')].filter(x=>!x.hidden);let clicked=0;
  visible.forEach(node=>node.querySelectorAll('button').forEach(btn=>{if(btn.id==='ffBusinessRefresh')return;const txt=(btn.textContent||'').trim().toLowerCase();if(txt.includes('refresh')){clicked++;btn.click()}}));
  if(!clicked&&active==='catalog')$('refreshProducts')?.click();
}
function start(){const dash=$('dashboard');if(!dash)return;if(dash.dataset.adminReady==='true'){buildShell();return}const o=new MutationObserver(()=>{if(dash.dataset.adminReady==='true'){o.disconnect();buildShell()}});o.observe(dash,{attributes:true,attributeFilter:['data-admin-ready']})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

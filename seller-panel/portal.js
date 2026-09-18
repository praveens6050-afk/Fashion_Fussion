'use strict';
const SELLER_ACCOUNT_KEY='ff_seller_accounts_v1';
const SELLER_SESSION_KEY='ff_seller_session_v1';
const portal$=id=>document.getElementById(id);
const portalEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const portalMoney=value=>'₹'+Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const portalDate=value=>new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value));
const starterOrders=[
  {id:'FFO-240918-1042',date:'2026-09-18T18:10:00+05:30',customer:'Aarav Mehta',items:2,total:1598,status:'new'},
  {id:'FFO-240918-1038',date:'2026-09-18T15:42:00+05:30',customer:'Neha Verma',items:1,total:899,status:'processing'},
  {id:'FFO-240917-1021',date:'2026-09-17T13:20:00+05:30',customer:'Rohan Gupta',items:3,total:2397,status:'shipped'},
  {id:'FFO-240916-0994',date:'2026-09-16T11:05:00+05:30',customer:'Simran Kaur',items:1,total:799,status:'completed'},
  {id:'FFO-240915-0962',date:'2026-09-15T16:31:00+05:30',customer:'Kabir Singh',items:2,total:1298,status:'cancelled'}
];
const starterPayments=[
  {id:'SET-20260918-01',period:'12–17 Sep 2026',gross:5694,fees:341.64,net:5352.36,status:'pending',due:'2026-09-20T00:00:00+05:30'},
  {id:'SET-20260912-01',period:'05–11 Sep 2026',gross:8420,fees:505.2,net:7914.8,status:'paid',due:'2026-09-13T00:00:00+05:30'},
  {id:'SET-20260905-01',period:'29 Aug–04 Sep 2026',gross:6250,fees:375,net:5875,status:'paid',due:'2026-09-06T00:00:00+05:30'}
];
const starterReturns=[
  {id:'RET-1048',order:'FFO-240914-0941',product:'Premium Cotton Oversized T-Shirt',reason:'Size did not fit',status:'return',requested:'2026-09-18T10:05:00+05:30'},
  {id:'RET-1039',order:'FFO-240911-0877',product:'Minimal Desk Organizer Set',reason:'Received damaged',status:'processing',requested:'2026-09-16T12:10:00+05:30'},
  {id:'RET-1024',order:'FFO-240906-0732',product:'Women Ribbed Everyday Top',reason:'Changed mind',status:'completed',requested:'2026-09-10T09:20:00+05:30'}
];
function readSellerSession(){try{return JSON.parse(localStorage.getItem(SELLER_SESSION_KEY)||sessionStorage.getItem(SELLER_SESSION_KEY)||'null')}catch{return null}}
function readSellerAccounts(){try{const rows=JSON.parse(localStorage.getItem(SELLER_ACCOUNT_KEY)||'[]');return Array.isArray(rows)?rows:[]}catch{return[]}}
function writeSellerAccounts(rows){localStorage.setItem(SELLER_ACCOUNT_KEY,JSON.stringify(rows))}
function currentSeller(){const session=readSellerSession();if(!session)return null;const account=readSellerAccounts().find(x=>String(x.email).toLowerCase()===String(session.email).toLowerCase());return account||{id:session.sellerId,storeName:session.storeName,email:session.email,firstName:String(session.name||'Seller').split(' ')[0],lastName:String(session.name||'').split(' ').slice(1).join(' '),mobile:'',sellerType:'business',kycStatus:'pending'}}
function initials(account){return [account.firstName,account.lastName].filter(Boolean).map(x=>String(x)[0]).join('').slice(0,2).toUpperCase()||'SL'}
function statusTag(status){const labels={new:'New',processing:'Processing',shipped:'Shipped',completed:'Completed',cancelled:'Cancelled',paid:'Paid',pending:'Pending',return:'Return requested'};return`<span class="tag ${portalEsc(status)}">${portalEsc(labels[status]||status)}</span>`}
function renderSellerIdentity(account){const name=[account.firstName,account.lastName].filter(Boolean).join(' ')||account.storeName||'Seller';if(portal$('sellerDisplayName'))portal$('sellerDisplayName').textContent=account.storeName||name;if(portal$('sellerDisplayId'))portal$('sellerDisplayId').textContent='Seller ID: '+account.id;if(portal$('sellerAvatar'))portal$('sellerAvatar').textContent=initials(account);if(portal$('overviewGreeting'))portal$('overviewGreeting').textContent='Good evening, '+(account.firstName||'Seller');}
function renderOrders(){const total=starterOrders.length,newCount=starterOrders.filter(x=>x.status==='new').length,processing=starterOrders.filter(x=>x.status==='processing').length,revenue=starterOrders.filter(x=>x.status!=='cancelled').reduce((s,x)=>s+x.total,0);portal$('orderMetricTotal').textContent=total;portal$('orderMetricNew').textContent=newCount;portal$('orderMetricProcessing').textContent=processing;portal$('orderMetricRevenue').textContent=portalMoney(revenue);const q=String(portal$('orderSearch')?.value||'').trim().toLowerCase(),rows=starterOrders.filter(x=>!q||[x.id,x.customer,x.status].some(v=>String(v).toLowerCase().includes(q)));portal$('ordersList').innerHTML='<div class="data-row header"><span>ORDER</span><span>CUSTOMER</span><span>ITEMS</span><span>AMOUNT</span><span>STATUS</span></div>'+rows.map(x=>`<div class="data-row"><div class="data-main"><strong>${portalEsc(x.id)}</strong><span>${portalDate(x.date)}</span></div><span>${portalEsc(x.customer)}</span><span>${x.items} item${x.items===1?'':'s'}</span><strong>${portalMoney(x.total)}</strong>${statusTag(x.status)}</div>`).join('')+(rows.length?'':'<div class="empty-inline">No matching orders.</div>')}
function renderPayments(){const paid=starterPayments.filter(x=>x.status==='paid').reduce((s,x)=>s+x.net,0),pending=starterPayments.filter(x=>x.status==='pending').reduce((s,x)=>s+x.net,0);portal$('paymentPaid').textContent=portalMoney(paid);portal$('paymentPending').textContent=portalMoney(pending);portal$('paymentsList').innerHTML='<div class="data-row header"><span>SETTLEMENT</span><span>PERIOD</span><span>GROSS</span><span>NET PAYOUT</span><span>STATUS</span></div>'+starterPayments.map(x=>`<div class="data-row"><div class="data-main"><strong>${portalEsc(x.id)}</strong><span>Due ${portalDate(x.due)}</span></div><span>${portalEsc(x.period)}</span><span>${portalMoney(x.gross)}</span><strong class="${x.status==='paid'?'money-positive':''}">${portalMoney(x.net)}</strong>${statusTag(x.status)}</div>`).join('')}
function renderReturns(){portal$('returnOpen').textContent=starterReturns.filter(x=>x.status!=='completed').length;portal$('returnClosed').textContent=starterReturns.filter(x=>x.status==='completed').length;portal$('returnsList').innerHTML='<div class="data-row header"><span>RETURN</span><span>ORDER</span><span>PRODUCT / REASON</span><span>REQUESTED</span><span>STATUS</span></div>'+starterReturns.map(x=>`<div class="data-row"><div class="data-main"><strong>${portalEsc(x.id)}</strong><span>${portalEsc(x.product)}</span></div><span>${portalEsc(x.order)}</span><div class="data-main"><strong>${portalEsc(x.reason)}</strong><span>Customer request</span></div><span>${portalDate(x.requested)}</span>${statusTag(x.status)}</div>`).join('')}
function populateProfile(account){const map={profileStoreName:account.storeName,profileEmail:account.email,profileMobile:account.mobile,profileSellerType:account.sellerType,profileFirstName:account.firstName,profileLastName:account.lastName};Object.entries(map).forEach(([id,value])=>{if(portal$(id))portal$(id).value=value||''});const completed=[account.storeName,account.email,account.mobile,account.firstName,account.lastName].filter(Boolean).length;const pct=Math.round(completed/5*70)+(account.kycStatus==='verified'?30:0);if(portal$('profileProgress'))portal$('profileProgress').style.width=Math.min(100,pct)+'%';if(portal$('profileProgressText'))portal$('profileProgressText').textContent=Math.min(100,pct)+'% account setup complete';if(portal$('kycStatus'))portal$('kycStatus').textContent=account.kycStatus==='verified'?'Verified':'Pending integration'}
function saveProfile(event){event.preventDefault();const session=readSellerSession(),rows=readSellerAccounts(),index=rows.findIndex(x=>String(x.email).toLowerCase()===String(session.email).toLowerCase());if(index<0){if(typeof toast==='function')toast('Profile cannot be updated for this session.');return}const updated={...rows[index],storeName:portal$('profileStoreName').value.trim(),firstName:portal$('profileFirstName').value.trim(),lastName:portal$('profileLastName').value.trim(),mobile:portal$('profileMobile').value.trim(),sellerType:portal$('profileSellerType').value};rows[index]=updated;writeSellerAccounts(rows);const storage=localStorage.getItem(SELLER_SESSION_KEY)?localStorage:sessionStorage;storage.setItem(SELLER_SESSION_KEY,JSON.stringify({...session,storeName:updated.storeName,name:[updated.firstName,updated.lastName].filter(Boolean).join(' ')}));renderSellerIdentity(updated);populateProfile(updated);if(typeof toast==='function')toast('Seller profile saved locally.');}
function logoutSeller(){localStorage.removeItem(SELLER_SESSION_KEY);sessionStorage.removeItem(SELLER_SESSION_KEY);location.href='login.html'}
const seller=readSellerSession();
if(!seller){location.replace('login.html')}else{const account=currentSeller();renderSellerIdentity(account);renderOrders();renderPayments();renderReturns();populateProfile(account);portal$('orderSearch')?.addEventListener('input',renderOrders);portal$('sellerProfileForm')?.addEventListener('submit',saveProfile);portal$('logoutSeller')?.addEventListener('click',logoutSeller)}

window.SellerCatalogBridge={
  getProducts:()=>products,
  makeId:()=>uid(),
  notify:message=>toast(message),
  commit:next=>{products=next;persist();renderAll()},
  close:()=>closeDrawer(),
  showPendingProducts:()=>{activeStatus='pending';syncTabs();switchView('products');renderProducts()}
};
function loadSellerModule(src){const script=document.createElement('script');script.src=src;script.async=false;document.body.appendChild(script)}
loadSellerModule('operations-bootstrap.js');
loadSellerModule('catalog-enhancements.js');
loadSellerModule('inventory-fulfillment.js');
loadSellerModule('inventory-restock-fix.js');
loadSellerModule('analytics-shipping.js');
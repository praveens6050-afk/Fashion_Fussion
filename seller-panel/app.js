'use strict';

const STORAGE_KEY='ff_seller_panel_demo_v1';
const STATUS_LABELS={approved:'Live',pending:'Pending review',rejected:'Rejected'};
const starterProducts=[
  {id:'SP-1004',name:'Premium Cotton Oversized T-Shirt',category:'Men Fashion',sku:'FF-TSH-104',description:'Heavyweight cotton oversized T-shirt with soft finish and everyday relaxed fit.',price:799,mrp:1299,stock:48,gst:5,image:'',status:'approved',rejectionReason:'',createdAt:'2026-09-15T10:20:00+05:30',updatedAt:'2026-09-17T12:05:00+05:30',reviewedAt:'2026-09-17T12:05:00+05:30'},
  {id:'SP-1003',name:'Women Ribbed Everyday Top',category:'Women Fashion',sku:'FF-WRT-203',description:'Comfort ribbed top with stretch fabric and clean everyday silhouette.',price:649,mrp:999,stock:31,gst:5,image:'',status:'pending',rejectionReason:'',createdAt:'2026-09-17T17:20:00+05:30',updatedAt:'2026-09-17T17:20:00+05:30',reviewedAt:''},
  {id:'SP-1002',name:'Classic Stainless Steel Water Bottle',category:'Home & Kitchen',sku:'FF-BTL-022',description:'Leak-resistant stainless steel bottle for daily office, travel and home use.',price:499,mrp:799,stock:64,gst:18,image:'',status:'rejected',rejectionReason:'Main product image is missing. Please add a clear front image on a plain background and resubmit.',createdAt:'2026-09-14T09:10:00+05:30',updatedAt:'2026-09-16T15:45:00+05:30',reviewedAt:'2026-09-16T15:45:00+05:30'},
  {id:'SP-1001',name:'Minimal Desk Organizer Set',category:'Office',sku:'FF-DSK-011',description:'Compact organizer set designed for stationery, notes and small desk accessories.',price:899,mrp:1499,stock:17,gst:18,image:'',status:'approved',rejectionReason:'',createdAt:'2026-09-12T11:00:00+05:30',updatedAt:'2026-09-13T14:30:00+05:30',reviewedAt:'2026-09-13T14:30:00+05:30'}
];

let products=loadProducts();
let activeView='overview';
let activeStatus='all';
let editingId=null;

const $=id=>document.getElementById(id);
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>{if(char==='&')return'&amp;';if(char==='<')return'&lt;';if(char==='>')return'&gt;';if(char==='"')return'&quot;';return'&#39;'})}
const money=value=>'₹'+Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const statusHtml=status=>`<span class="status ${status}">${STATUS_LABELS[status]||status}</span>`;
const safeImage=url=>{try{const parsed=new URL(url);return ['http:','https:'].includes(parsed.protocol)?url:''}catch{return''}};

function loadProducts(){return []}
function persist(){localStorage.setItem(STORAGE_KEY,JSON.stringify(products))}
function uid(){return 'SP-'+String(Math.max(1000,...products.map(p=>Number(String(p.id).replace(/\D/g,''))||0))+1)}
function formatDate(value){if(!value)return'—';const date=new Date(value);if(Number.isNaN(date.getTime()))return'—';return new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(date)}
function formatTime(value){if(!value)return'';const date=new Date(value);if(Number.isNaN(date.getTime()))return'';return new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(date)}
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(window.__sellerToast);window.__sellerToast=setTimeout(()=>el.classList.remove('show'),2300)}
function placeholderText(product){const words=String(product.name||'Product').trim().split(/\s+/).filter(Boolean);return words.slice(0,2).map(x=>x[0]).join('').toUpperCase()||'PR'}
function thumbHtml(product){const url=safeImage(product.image);return `<div class="thumb">${url?`<img src="${esc(url)}" alt="" data-product-image>`:esc(placeholderText(product))}</div>`}
function bindImageFallbacks(){document.querySelectorAll('[data-product-image]').forEach(img=>img.addEventListener('error',()=>{const wrap=img.closest('.thumb');if(wrap)wrap.textContent='IMG'},{once:true}))}

function counts(){return products.reduce((acc,p)=>{acc.total++;acc[p.status]=(acc[p.status]||0)+1;return acc},{total:0,approved:0,pending:0,rejected:0})}
function renderStats(){const c=counts();$('statTotal').textContent=c.total;$('statApproved').textContent=c.approved;$('statPending').textContent=c.pending;$('statRejected').textContent=c.rejected;$('navProductCount').textContent=c.total;$('navReviewCount').textContent=c.pending+c.rejected;$('countAll').textContent=c.total;$('countApproved').textContent=c.approved;$('countPending').textContent=c.pending;$('countRejected').textContent=c.rejected;$('notificationDot').style.display=(c.pending+c.rejected)>0?'block':'none'}

function renderRecent(){
  const rows=[...products].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,5);
  $('recentProducts').innerHTML=rows.length?rows.map(p=>`<div class="compact-row"><div class="product-id">${thumbHtml(p)}<div><strong>${esc(p.name)}</strong><span>${esc(p.sku)} · ${formatDate(p.updatedAt)}</span></div></div>${statusHtml(p.status)}</div>`).join(''):'<div class="compact-row">No listings yet.</div>';
  bindImageFallbacks();
}
function activityText(p){if(p.status==='approved')return'Approved and now eligible to be shown to customers.';if(p.status==='rejected')return`Rejected: ${p.rejectionReason||'Admin requested changes.'}`;return'Submitted and waiting for admin review.'}
function renderActivity(){
  const rows=[...products].sort((a,b)=>new Date(b.reviewedAt||b.updatedAt)-new Date(a.reviewedAt||a.updatedAt)).slice(0,5);
  $('activityFeed').innerHTML=rows.map(p=>`<div class="activity-item"><span class="activity-dot ${p.status}"></span><div><strong>${esc(p.name)}</strong><p>${esc(activityText(p))}</p><time>${formatTime(p.reviewedAt||p.updatedAt)}</time></div></div>`).join('');
}

function filteredProducts(){
  const query=$('productSearch').value.trim().toLowerCase();
  return [...products].filter(p=>(activeStatus==='all'||p.status===activeStatus)&&(!query||[p.name,p.sku,p.category].some(v=>String(v||'').toLowerCase().includes(query)))).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
}
function renderProducts(){
  const rows=filteredProducts();
  $('productsEmpty').hidden=rows.length>0;
  $('productsTable').innerHTML=rows.map(p=>`<tr>
    <td><div class="product-id">${thumbHtml(p)}<div><strong>${esc(p.name)}</strong><span>${esc(p.category)}</span></div></div></td>
    <td>${esc(p.sku)}</td>
    <td><div class="price"><strong>${money(p.price)}</strong><span>MRP ${money(p.mrp)}</span></div></td>
    <td>${Number(p.stock||0).toLocaleString('en-IN')}</td>
    <td>${statusHtml(p.status)}</td>
    <td>${formatDate(p.updatedAt)}</td>
    <td><div class="row-actions"><button class="small-btn" data-edit="${esc(p.id)}">Edit</button><button class="small-btn" data-duplicate="${esc(p.id)}">Duplicate</button><button class="small-btn danger" data-delete="${esc(p.id)}">Delete</button></div></td>
  </tr>`).join('');
  bindImageFallbacks();
}

function renderReviewCards(){
  const sorted=[...products].sort((a,b)=>({rejected:0,pending:1,approved:2}[a.status]-{rejected:0,pending:1,approved:2}[b.status]||new Date(b.updatedAt)-new Date(a.updatedAt)));
  $('reviewCards').innerHTML=sorted.length?sorted.map(p=>`<article class="review-card"><div><div class="meta">${thumbHtml(p)}<div><h3>${esc(p.name)}</h3><p class="details">${esc(p.sku)} · Updated ${formatDate(p.updatedAt)}</p></div>${statusHtml(p.status)}</div>${p.status==='rejected'?`<div class="reason"><strong>Admin rejection reason:</strong> ${esc(p.rejectionReason||'Changes required before approval.')}</div>`:''}${p.status==='pending'?'<div class="pending-note">This product is not visible to customers while admin review is pending.</div>':''}${p.status==='approved'?'<div class="pending-note" style="background:var(--green-bg);color:var(--green)">Approved. This listing is ready to be treated as live when storefront integration is connected.</div>':''}</div><div class="review-actions"><button class="small-btn" data-edit="${esc(p.id)}">${p.status==='rejected'?'Fix & resubmit':'Edit listing'}</button></div></article>`).join(''):'<div class="empty-state"><h3>No listings yet</h3></div>';
  bindImageFallbacks();
}

function renderAll(){renderStats();renderRecent();renderActivity();renderProducts();renderReviewCards()}

function switchView(view){
  activeView=view;
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  document.querySelectorAll('.nav-item[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
  if(view==='products')$('productSearch').focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'smooth'});
}

function openDrawer(id=null){
  editingId=id;
  const product=id?products.find(p=>p.id===id):null;
  $('productForm').reset();
  $('productId').value=product?.id||'';
  $('drawerTitle').textContent=product?'Edit product':'Add product';
  $('submitProduct').textContent=product?'Save & submit for review':'Submit for review';
  $('editReviewWarning').hidden=!product;
  if(product){$('name').value=product.name||'';$('category').value=product.category||'';$('sku').value=product.sku||'';$('description').value=product.description||'';$('price').value=product.price??'';$('mrp').value=product.mrp??'';$('stock').value=product.stock??'';$('gst').value=String(product.gst??18);$('image').value=product.image||''}
  else{$('gst').value='18'}
  $('drawerBackdrop').hidden=false;$('productDrawer').classList.add('open');$('productDrawer').setAttribute('aria-hidden','false');setTimeout(()=>$('name').focus(),80);
}
function closeDrawer(){$('productDrawer').classList.remove('open');$('productDrawer').setAttribute('aria-hidden','true');$('drawerBackdrop').hidden=true;editingId=null}

function formPayload(){
  return{name:$('name').value.trim(),category:$('category').value.trim(),sku:$('sku').value.trim().toUpperCase(),description:$('description').value.trim(),price:Number($('price').value),mrp:Number($('mrp').value),stock:Number($('stock').value),gst:Number($('gst').value),image:$('image').value.trim()};
}
function validateProduct(data,id){
  if(!data.name||!data.category||!data.sku||!data.description)return'Please complete all required product information.';
  if(!Number.isFinite(data.price)||data.price<=0||!Number.isFinite(data.mrp)||data.mrp<=0)return'Enter valid price and MRP values.';
  if(data.mrp<data.price)return'MRP cannot be lower than the selling price.';
  if(!Number.isInteger(data.stock)||data.stock<0)return'Stock must be a whole number of 0 or more.';
  if(data.image&&!safeImage(data.image))return'Image URL must start with http:// or https://.';
  if(products.some(p=>p.sku.toLowerCase()===data.sku.toLowerCase()&&p.id!==id))return'This seller SKU is already used by another product.';
  return'';
}
function submitForm(event){
  event.preventDefault();
  if(!window.SellerLiveIntegration){toast('Seller catalog is still loading. Please refresh and try again.');return}
  const data=formPayload();
  const error=validateProduct(data,editingId);
  if(error){toast(error);return}
  const now=new Date().toISOString();
  if(editingId){
    const index=products.findIndex(p=>p.id===editingId);if(index<0)return;
    products[index]={...products[index],...data,status:'pending',rejectionReason:'',reviewedAt:'',updatedAt:now};
    toast('Changes saved. Product sent back to admin review.');
  }else{
    products.unshift({id:uid(),...data,status:'pending',rejectionReason:'',createdAt:now,updatedAt:now,reviewedAt:''});
    toast('Product submitted for admin review.');
  }
  persist();closeDrawer();renderAll();switchView('products');activeStatus='pending';syncTabs();renderProducts();
}

function syncTabs(){document.querySelectorAll('#statusTabs .tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.status===activeStatus))}
function duplicateProduct(id){
  if(!window.SellerLiveIntegration){toast('Seller catalog is unavailable. Please refresh and try again.');return}
  const source=products.find(p=>p.id===id);if(!source)return;
  const now=new Date().toISOString();
  const copy={...source,id:uid(),name:`${source.name} Copy`,sku:`${source.sku}-COPY-${Date.now().toString().slice(-4)}`,status:'pending',rejectionReason:'',createdAt:now,updatedAt:now,reviewedAt:''};
  products.unshift(copy);persist();renderAll();toast('Product duplicated as a new pending listing.');
}
function deleteProduct(id){
  if(!window.SellerLiveIntegration){toast('Seller catalog is unavailable. Please refresh and try again.');return}
  const product=products.find(p=>p.id===id);if(!product)return;
  if(!confirm(`Delete “${product.name}”? This only removes it from this standalone seller prototype.`))return;
  products=products.filter(p=>p.id!==id);persist();renderAll();toast('Product deleted.');
}
function resetDemo(){if(!confirm('Reset seller panel to the original demo listings?'))return;products=structuredClone(starterProducts);persist();activeStatus='all';$('productSearch').value='';syncTabs();renderAll();toast('Demo data restored.');switchView('overview')}

function handleAction(target){
  const add=target.closest('[data-action="add-product"]');if(add){openDrawer();return true}
  const view=target.closest('[data-view]');if(view){switchView(view.dataset.view);return true}
  const edit=target.closest('[data-edit]');if(edit){openDrawer(edit.dataset.edit);return true}
  const duplicate=target.closest('[data-duplicate]');if(duplicate){if(window.SellerLiveIntegration)return false;duplicateProduct(duplicate.dataset.duplicate);return true}
  const del=target.closest('[data-delete]');if(del){if(window.SellerLiveIntegration)return false;deleteProduct(del.dataset.delete);return true}
  return false;
}

document.addEventListener('click',event=>{
  if(handleAction(event.target)){
    event.preventDefault();
    event.stopImmediatePropagation();
  }
},true);
$('statusTabs').addEventListener('click',event=>{const tab=event.target.closest('[data-status]');if(!tab)return;activeStatus=tab.dataset.status;syncTabs();renderProducts()});
$('productSearch').addEventListener('input',renderProducts);
$('globalSearch').addEventListener('input',event=>{const value=event.target.value.trim();if(value){switchView('products');$('productSearch').value=value;activeStatus='all';syncTabs();renderProducts()}else if(activeView==='products'){$('productSearch').value='';renderProducts()}});
$('productForm').addEventListener('submit',submitForm);
$('closeDrawer').addEventListener('click',closeDrawer);
$('cancelDrawer').addEventListener('click',closeDrawer);
$('drawerBackdrop').addEventListener('click',closeDrawer);
$('resetDemo').addEventListener('click',resetDemo);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('globalSearch').focus()}if(event.key==='Escape'&&$('productDrawer').classList.contains('open'))closeDrawer()});

persist();renderAll();syncTabs();

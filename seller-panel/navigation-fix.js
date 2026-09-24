(()=>{'use strict';
function ensureImageUploader(){
  if(document.querySelector('script[data-seller-product-image-upload]'))return;
  const script=document.createElement('script');
  script.src='product-image-upload.js?v=20260922-readiness';
  script.defer=true;
  script.setAttribute('data-seller-product-image-upload','true');
  document.head.appendChild(script);
}
function ensureWithdrawnStateSupport(){
  if(!document.getElementById('seller-withdrawn-state-style')){
    const style=document.createElement('style');
    style.id='seller-withdrawn-state-style';
    style.textContent='.status.withdrawn{color:#667085;background:#f2f4f7}.activity-dot.withdrawn{background:#98a2b3}.withdrawn-note{background:#f2f4f7!important;color:#596274!important}';
    document.head.appendChild(style);
  }
  const tabs=document.getElementById('statusTabs');
  if(tabs&&!document.getElementById('countWithdrawn')){
    const button=document.createElement('button');
    button.className='tab';
    button.type='button';
    button.dataset.status='withdrawn';
    button.innerHTML='Withdrawn <span id="countWithdrawn">0</span>';
    tabs.appendChild(button);
  }
}
function patchWithdrawnStateUI(){
  ensureWithdrawnStateSupport();
  document.querySelectorAll('.status.withdrawn').forEach(el=>{if(el.textContent.trim()!=='Withdrawn')el.textContent='Withdrawn';});
  document.querySelectorAll('.activity-dot.withdrawn').forEach(dot=>{
    const item=dot.closest('.activity-item');
    const text=item?.querySelector('p');
    if(text&&text.textContent!=='Withdrawn by seller and not customer-visible.')text.textContent='Withdrawn by seller and not customer-visible.';
  });
  document.querySelectorAll('.review-card').forEach(card=>{
    if(!card.querySelector('.status.withdrawn'))return;
    const body=card.firstElementChild;
    if(body&&!body.querySelector('.withdrawn-note')){
      const note=document.createElement('div');
      note.className='pending-note withdrawn-note';
      note.textContent='Withdrawn by seller. This listing is not visible to customers and can be edited and resubmitted.';
      body.appendChild(note);
    }
    const action=card.querySelector('.review-actions .small-btn');
    if(action&&action.textContent!=='Edit & resubmit')action.textContent='Edit & resubmit';
  });
  const count=document.getElementById('countWithdrawn');
  const products=window.SellerCatalogBridge?.getProducts?.();
  if(count&&Array.isArray(products)){
    const value=String(products.filter(product=>product?.status==='withdrawn').length);
    if(count.textContent!==value)count.textContent=value;
  }
}
function watchWithdrawnState(){
  if(window.__sellerWithdrawnObserver)return;
  window.__sellerWithdrawnObserver=new MutationObserver(()=>patchWithdrawnStateUI());
  window.__sellerWithdrawnObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
  patchWithdrawnStateUI();
}
function activate(view){
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+view));
  document.querySelectorAll('.nav-item[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
  if(view==='products'){
    const all=document.querySelector('#statusTabs [data-status="all"]');
    if(all&&!all.classList.contains('active'))all.click();
    document.getElementById('productSearch')?.focus({preventScroll:true});
  }
  window.scrollTo({top:0,behavior:'smooth'});
}
function openProductDrawer(){
  const form=document.getElementById('productForm');
  if(form)form.reset();
  const title=document.getElementById('drawerTitle');
  if(title)title.textContent='Add product';
  const submit=document.getElementById('submitProduct');
  if(submit)submit.textContent='Submit for review';
  const backdrop=document.getElementById('drawerBackdrop');
  if(backdrop)backdrop.hidden=false;
  const drawer=document.getElementById('productDrawer');
  if(drawer){drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');}
}
function bind(){
  ensureImageUploader();
  watchWithdrawnState();
  document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
    if(btn.dataset.view==='support-live')return;
    btn.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();activate(btn.dataset.view)},true);
  });
  document.querySelectorAll('[data-action="add-product"]').forEach(btn=>{
    btn.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();openProductDrawer()},true);
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
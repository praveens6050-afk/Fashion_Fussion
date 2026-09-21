'use strict';
const SELLER_SESSION_KEY='ff_seller_session_v1';
const portal$=id=>document.getElementById(id);

function readSellerSession(){
  try{return JSON.parse(localStorage.getItem(SELLER_SESSION_KEY)||sessionStorage.getItem(SELLER_SESSION_KEY)||'null')}
  catch{return null}
}

function renderProvisionalIdentity(session){
  if(!session)return;
  const storeName=String(session.storeName||'Seller').trim()||'Seller';
  const name=String(session.name||'Seller').trim()||'Seller';
  const initials=name.split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase()||storeName.slice(0,2).toUpperCase();
  if(portal$('sellerDisplayName'))portal$('sellerDisplayName').textContent=storeName;
  if(portal$('sellerDisplayId'))portal$('sellerDisplayId').textContent=session.sellerCode?'Seller ID: '+session.sellerCode:'Seller account';
  if(portal$('sellerAvatar'))portal$('sellerAvatar').textContent=initials;
  if(portal$('overviewGreeting'))portal$('overviewGreeting').textContent='Welcome, '+(name.split(/\s+/)[0]||storeName);
}

renderProvisionalIdentity(readSellerSession());

if(!window.__sellerNavigationCaptureBound){
  window.__sellerNavigationCaptureBound=true;
  document.addEventListener('click',event=>{
    const target=event.target;
    if(!(target instanceof Element))return;
    const add=target.closest('[data-action="add-product"]');
    if(add){
      event.preventDefault();
      event.stopImmediatePropagation();
      openDrawer();
      return;
    }
    const view=target.closest('[data-view]');
    if(view&&view.dataset.view&&view.dataset.view!=='support-live'){
      event.preventDefault();
      event.stopImmediatePropagation();
      switchView(view.dataset.view);
    }
  },true);
}

window.SellerCatalogBridge={
  getProducts:()=>products,
  makeId:()=>uid(),
  notify:message=>toast(message),
  commit:next=>{products=Array.isArray(next)?next:[];persist();renderAll()},
  close:()=>closeDrawer(),
  showPendingProducts:()=>{activeStatus='pending';syncTabs();switchView('products');renderProducts()}
};

function loadSellerModule(src){
  const script=document.createElement('script');
  script.src=src;
  script.async=false;
  document.body.appendChild(script);
}

// Production launch scope: live catalog/review + support only.
// Operational prototypes remain in source for future integration but are not executed.
loadSellerModule('seller-storage-scope.js');
loadSellerModule('catalog-enhancements.js');
loadSellerModule('product-image-upload.js?v=20260921-file-upload');
loadSellerModule('seller-support.js?v=1');

'use strict';
const SELLER_SESSION_KEY='ff_seller_session_v1';
const SELLER_DEMO_STORAGE_KEY='ff_seller_panel_demo_v1';
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

// app.js still supplies the shared rendering shell, but production must never fall
// back to its historical browser-local demo catalog or mutate that catalog locally.
try{localStorage.removeItem(SELLER_DEMO_STORAGE_KEY)}catch{}
products=[];
renderAll();
submitForm=function(event){event.preventDefault();toast('Live seller catalog is still loading. Please try again.')};
duplicateProduct=function(id){const live=window.SellerLiveIntegration;if(live?.duplicate)return live.duplicate(id);toast('Live seller catalog is still loading. Please try again.')};
deleteProduct=function(id){const live=window.SellerLiveIntegration;if(live?.remove)return live.remove(id);toast('Live seller catalog is still loading. Please try again.')};
resetDemo=function(){toast('Demo mode is disabled in the production seller portal.')};

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
  commit:next=>{products=Array.isArray(next)?next:[];try{localStorage.removeItem(SELLER_DEMO_STORAGE_KEY)}catch{}renderAll()},
  close:()=>closeDrawer(),
  showPendingProducts:()=>{activeStatus='pending';syncTabs();switchView('products');renderProducts()}
};

function loadSellerModule(src){
  const script=document.createElement('script');
  script.src=src;
  script.async=false;
  document.body.appendChild(script);
}

function loadSellerStyle(href){
  if(document.querySelector(`link[href="${href}"]`))return;
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}

loadSellerStyle('sidebar-compact.css?v=20260921-menu');
loadSellerStyle('seller-hub-premium.css?v=20260921-hub');

// Live catalog/review, seller operations and support use database-authoritative data.
// Premium modules only improve presentation around those live data sources.
loadSellerModule('seller-storage-scope.js');
loadSellerModule('catalog-enhancements.js');
loadSellerModule('product-image-upload.js?v=20260922-readiness');
loadSellerModule('seller-support.js?v=20260930-support-readiness');
loadSellerModule('seller-kyc-status.js?v=20260930-kyc-copy');
loadSellerModule('seller-finance-onboarding.js?v=20260930-live-finance');
loadSellerModule('seller-live-operations.js?v=20260930-live-operations-search');
loadSellerModule('seller-hub-premium.js?v=20260921-hub');

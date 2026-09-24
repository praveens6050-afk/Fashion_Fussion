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
  commit:next=>{products=Array.isArray(next)?next:[];renderAll()},
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

function restoreSellerShell(){
  if(document.documentElement.classList.contains('seller-live-loading'))return;
  const main=document.querySelector('.main');
  const sidebar=document.querySelector('.sidebar');
  const topbar=document.querySelector('.topbar');
  [main,sidebar,topbar].forEach(el=>{
    if(!el)return;
    el.style.setProperty('visibility','visible','important');
    el.style.setProperty('opacity','1','important');
  });
  if(main)main.style.setProperty('display','block','important');
  if(sidebar){
    sidebar.style.setProperty('display','flex','important');
    sidebar.style.setProperty('background','#101828','important');
  }
  if(topbar)topbar.style.setProperty('display','flex','important');

  const core=['overview','products','review','payments','profile'];
  core.forEach(view=>{
    const button=document.querySelector(`.nav-item[data-view="${view}"]`);
    if(button){button.hidden=false;button.removeAttribute('aria-hidden');button.removeAttribute('tabindex')}
  });
  if(!document.querySelector('.content.view.active')){
    document.getElementById('view-overview')?.classList.add('active');
    document.querySelector('.nav-item[data-view="overview"]')?.classList.add('active');
  }
}

loadSellerStyle('sidebar-compact.css?v=20260924-shell-fix');
loadSellerStyle('seller-hub-premium.css?v=20260924-shell-fix');
loadSellerStyle('seller-shell-recovery.css?v=20260924-shell-fix');

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{restoreSellerShell();setTimeout(restoreSellerShell,500);setTimeout(restoreSellerShell,1800)},{once:true});
else{restoreSellerShell();setTimeout(restoreSellerShell,500);setTimeout(restoreSellerShell,1800)}

// Live catalog/review + support stay unchanged; operations and finance are seller-scoped through Supabase RPC.
loadSellerModule('seller-storage-scope.js');
loadSellerModule('catalog-enhancements.js');
loadSellerModule('product-image-upload.js?v=20260922-readiness');
loadSellerModule('seller-support.js?v=2');
loadSellerModule('seller-operations-live.js?v=20260924-live');
loadSellerModule('seller-finance-compliance-live.js?v=20260924-live');
loadSellerModule('seller-settlement-live.js?v=20260924-deduction-breakdown-v2');
loadSellerModule('seller-hub-premium.js?v=20260924-shell-fix');

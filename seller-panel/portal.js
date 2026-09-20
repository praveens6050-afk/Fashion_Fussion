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
  if(portal$('sellerDisplayId'))portal$('sellerDisplayId').textContent=session.sellerId&&session.sellerId!=='LIVE'?'Seller ID: '+String(session.sellerId).slice(0,8).toUpperCase():'Seller account';
  if(portal$('sellerAvatar'))portal$('sellerAvatar').textContent=initials;
  if(portal$('overviewGreeting'))portal$('overviewGreeting').textContent='Welcome, '+(name.split(/\s+/)[0]||storeName);
}

renderProvisionalIdentity(readSellerSession());

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

// Production launch scope: catalog submissions + review workflow only.
// Operational prototypes remain in source for future integration but are not executed.
loadSellerModule('seller-storage-scope.js');
loadSellerModule('catalog-enhancements.js');

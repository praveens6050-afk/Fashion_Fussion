'use strict';
(()=>{
  const blockedViews=new Set([
    'orders','returns','inventory','analytics','shipping','onboarding','settings','support','tax','team',
    'promotions','quotes','scorecard','bulk-tools','reports','messages','locations','sla','accounting'
  ]);
  const coreViews=new Set(['overview','products','review','payments','profile']);
  const blockedIds=new Set([
    'dashboardExtras','customizeDashboard','sellerNotificationsButton','sellerNotificationPanel','sellerOrderModal'
  ]);

  function hide(el){
    if(!el)return;
    el.hidden=true;
    el.setAttribute('aria-hidden','true');
    if(el.matches?.('.nav-item,[data-view]'))el.setAttribute('tabindex','-1');
  }

  function show(el){
    if(!el)return;
    el.hidden=false;
    el.removeAttribute('aria-hidden');
    if(el.matches?.('.nav-item,[data-view]'))el.removeAttribute('tabindex');
  }

  function apply(){
    document.querySelectorAll('.nav-item[data-view]').forEach(button=>{
      const view=button.dataset.view;
      if(blockedViews.has(view))hide(button);
      else if(coreViews.has(view))show(button);
    });
    blockedViews.forEach(view=>hide(document.getElementById('view-'+view)));
    coreViews.forEach(view=>show(document.getElementById('view-'+view)));
    blockedIds.forEach(id=>hide(document.getElementById(id)));
    document.querySelectorAll('.top-actions .icon-btn[aria-label="Notifications"],.top-actions .icon-btn[aria-label="Seller notifications"]').forEach(hide);
  }

  const style=document.createElement('style');
  style.id='seller-launch-safety-style';
  const selectors=[
    ...[...blockedViews].map(view=>`.nav-item[data-view="${view}"]`),
    ...[...blockedViews].map(view=>`#view-${view}`),
    ...[...blockedIds].map(id=>`#${id}`),
    '.top-actions .icon-btn[aria-label="Notifications"]',
    '.top-actions .icon-btn[aria-label="Seller notifications"]'
  ];
  style.textContent=selectors.join(',')+'{display:none!important}';
  document.head.appendChild(style);

  const observer=new MutationObserver(()=>apply());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();

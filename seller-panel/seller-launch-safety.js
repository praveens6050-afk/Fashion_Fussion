'use strict';
(()=>{
  const blockedViews=new Set([
    'orders','payments','returns','inventory','analytics','shipping','onboarding','settings','support','tax','team',
    'promotions','quotes','scorecard','bulk-tools','reports','messages','locations','sla','accounting'
  ]);
  const blockedIds=new Set([
    'dashboardExtras','customizeDashboard','sellerNotificationsButton','sellerNotificationPanel','sellerOrderModal'
  ]);

  function hide(el){
    if(!el)return;
    el.hidden=true;
    el.setAttribute('aria-hidden','true');
    if(el.matches?.('.nav-item,[data-view]'))el.setAttribute('tabindex','-1');
  }

  function apply(){
    document.querySelectorAll('.nav-item[data-view]').forEach(button=>{
      if(blockedViews.has(button.dataset.view))hide(button);
    });
    blockedViews.forEach(view=>hide(document.getElementById('view-'+view)));
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

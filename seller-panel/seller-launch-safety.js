'use strict';
(()=>{
  const disabledViews=new Set(['orders','payments','returns']);
  const apply=()=>{
    document.querySelectorAll('.nav-item[data-view]').forEach(button=>{
      if(disabledViews.has(button.dataset.view)){
        button.hidden=true;
        button.setAttribute('aria-hidden','true');
        button.setAttribute('tabindex','-1');
      }
    });
    disabledViews.forEach(view=>{
      const section=document.getElementById('view-'+view);
      if(section){section.hidden=true;section.setAttribute('aria-hidden','true')}
    });
  };
  const style=document.createElement('style');
  style.id='seller-launch-safety-style';
  style.textContent='.nav-item[data-view="orders"],.nav-item[data-view="payments"],.nav-item[data-view="returns"],#view-orders,#view-payments,#view-returns{display:none!important}';
  document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();

'use strict';
(function(){
  const nav=document.querySelector('.crm-nav');
  const dashboard=document.getElementById('dashboard');
  if(!nav||!dashboard)return;
  function sync(){
    if(dashboard.hidden)return;
    nav.querySelectorAll('[data-crm-target]').forEach(link=>{
      const target=document.getElementById(link.dataset.crmTarget);
      const hidden=!target||target.hidden||getComputedStyle(target).display==='none';
      if(link.hidden!==hidden)link.hidden=hidden;
    });
  }
  function active(){
    if(dashboard.hidden)return;
    const links=[...nav.querySelectorAll('a:not([hidden])')];
    let current=links[0];
    for(const link of links){
      const target=document.getElementById(link.dataset.crmTarget);
      if(target&&target.getBoundingClientRect().top<innerHeight*.48)current=link;
    }
    links.forEach(link=>{
      if(link===current){if(link.getAttribute('aria-current')!=='true')link.setAttribute('aria-current','true');}
      else if(link.hasAttribute('aria-current'))link.removeAttribute('aria-current');
    });
  }
  nav.addEventListener('click',event=>{
    const link=event.target.closest('a[data-crm-target]');
    if(!link)return;
    const target=document.getElementById(link.dataset.crmTarget);
    if(target){event.preventDefault();target.scrollIntoView({behavior:'smooth',block:'start'});history.replaceState(null,'','#'+target.id);}
  });
  const observer=new MutationObserver(records=>{
    if(dashboard.hidden)return;
    const relevant=records.some(record=>!(record.type==='attributes'&&record.attributeName==='hidden'&&nav.contains(record.target)));
    if(!relevant)return;
    sync();active();
  });
  observer.observe(dashboard,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style']});
  document.addEventListener('scroll',active,{passive:true});
  window.addEventListener('resize',active);
  document.addEventListener('ff-crm-ready',sync);
  setTimeout(sync,300);
  setTimeout(sync,1400);
})();

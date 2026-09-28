(function(){
'use strict';
if(window.__ffCartMobileStructuralReflow)return;
window.__ffCartMobileStructuralReflow=true;

const mq=window.matchMedia('(max-width: 900px)');
const layout=document.querySelector('main.page .layout');
const section=layout?.querySelector(':scope > section');
let summary=layout?.querySelector(':scope > .summary')||section?.querySelector(':scope > .summary');
if(!layout||!section||!summary)return;

const slot=document.createComment('ff-cart-summary-desktop-slot');
if(summary.parentNode===layout)layout.insertBefore(slot,summary);

const setImportant=(el,prop,value)=>el.style.setProperty(prop,value,'important');
const clearProps=(el,props)=>props.forEach(prop=>el.style.removeProperty(prop));
const summaryProps=['position','inset','top','left','right','bottom','width','max-width','min-width','margin','transform','z-index','float'];
const layoutProps=['display','grid-template-columns','width','max-width','overflow'];
const sectionProps=['display','width','max-width','min-width','position','overflow'];

function applyMobile(){
  if(summary.parentNode!==section)section.appendChild(summary);
  layout.dataset.mobileStructuralReflow='true';
  summary.dataset.mobileStructuralReflow='true';

  setImportant(layout,'display','block');
  setImportant(layout,'width','100%');
  setImportant(layout,'max-width','100%');
  setImportant(layout,'overflow','visible');

  setImportant(section,'display','block');
  setImportant(section,'width','100%');
  setImportant(section,'max-width','100%');
  setImportant(section,'min-width','0');
  setImportant(section,'position','relative');
  setImportant(section,'overflow','visible');

  setImportant(summary,'position','relative');
  setImportant(summary,'inset','auto');
  setImportant(summary,'top','auto');
  setImportant(summary,'left','auto');
  setImportant(summary,'right','auto');
  setImportant(summary,'bottom','auto');
  setImportant(summary,'width','100%');
  setImportant(summary,'max-width','100%');
  setImportant(summary,'min-width','0');
  setImportant(summary,'margin','14px 0 0');
  setImportant(summary,'transform','none');
  setImportant(summary,'z-index','auto');
  setImportant(summary,'float','none');
}

function restoreDesktop(){
  if(slot.parentNode===layout&&summary.parentNode!==layout)slot.after(summary);
  delete layout.dataset.mobileStructuralReflow;
  delete summary.dataset.mobileStructuralReflow;
  clearProps(layout,layoutProps);
  clearProps(section,sectionProps);
  clearProps(summary,summaryProps);
}

function apply(){
  if(mq.matches||window.innerWidth<=900)applyMobile();
  else restoreDesktop();
}

apply();
if(typeof mq.addEventListener==='function')mq.addEventListener('change',apply);
else if(typeof mq.addListener==='function')mq.addListener(apply);
window.addEventListener('orientationchange',()=>setTimeout(apply,50),{passive:true});
window.addEventListener('resize',apply,{passive:true});

const observer=new MutationObserver(()=>{
  if((mq.matches||window.innerWidth<=900)&&summary.parentNode!==section)applyMobile();
});
observer.observe(layout,{childList:true,subtree:false});
window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
})();

(function(){
'use strict';
const params=new URLSearchParams(location.search);
const orderRef=String(params.get('id')||params.get('order')||'').trim();
if(!orderRef)return;

function waitFor(selector,timeout=10000){
  return new Promise((resolve,reject)=>{
    const found=document.querySelector(selector);
    if(found)return resolve(found);
    const observer=new MutationObserver(()=>{
      const el=document.querySelector(selector);
      if(!el)return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    const timer=setTimeout(()=>{
      observer.disconnect();
      reject(new Error('Support interface is still loading. Please try again.'));
    },timeout);
  });
}

function normalized(value){return String(value||'').toLowerCase().replace(/^order\s*#?/,'').replace(/[^a-z0-9]/g,'')}

async function openOrderSupport(event){
  event?.preventDefault();
  try{
    const launcher=await waitFor('#ffSupportLauncher');
    const panel=await waitFor('#ffSupportPanel');
    if(!panel.classList.contains('open'))launcher.click();
    const newTicket=await waitFor('#ffNewAdmin');
    newTicket.click();
    const orderSelect=await waitFor('#ffOrder');
    const wanted=normalized(orderRef);
    const option=[...orderSelect.options].find(opt=>String(opt.value)===orderRef||normalized(opt.textContent).includes(wanted));
    if(option)orderSelect.value=option.value;
    const issue=document.getElementById('ffIssueType');
    if(issue)issue.value='order_help';
    const subject=document.getElementById('ffSubject');
    if(subject&&!subject.value)subject.value='Help with order '+orderRef;
    document.getElementById('ffMessage')?.focus();
  }catch(error){
    console.error('Could not open order support ticket',error);
    alert(error.message||'Support could not be opened. Please try again.');
  }
}

function bind(){
  const actions=document.querySelector('#actionsSection .action-list');
  if(!actions)return false;
  const target=[...actions.querySelectorAll('a,button')].find(el=>/need help with this order/i.test(el.textContent||''));
  if(!target||target.dataset.orderSupportBound==='true')return Boolean(target);
  target.dataset.orderSupportBound='true';
  if(target.tagName==='A')target.setAttribute('href','#support');
  target.addEventListener('click',openOrderSupport);
  return true;
}

if(!bind()){
  const observer=new MutationObserver(()=>{if(bind())observer.disconnect()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),15000);
}
})();
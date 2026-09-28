(function(){
'use strict';
function enhance(){
  document.querySelectorAll('#ordersList .order').forEach(card=>{
    if(card.dataset.paymentActions==='true')return;
    const badge=String(card.querySelector('.badge')?.textContent||'').trim().toLowerCase();
    if(!['payment pending','payment failed','payment expired'].includes(badge))return;
    const actions=card.querySelector('.order-actions');
    const details=actions?.querySelector('a[href*="order-details.html?id="]');
    if(!actions||!details)return;
    const url=new URL(details.href,location.href);
    const id=url.searchParams.get('id');if(!id)return;
    const link=document.createElement('a');link.className='btn';
    if(badge==='payment pending'){
      link.classList.add('primary');link.href='order-details.html?id='+encodeURIComponent(id)+'#payment';link.textContent='Complete payment';
    }else{
      link.href='cart.html';link.textContent='Return to cart';
    }
    actions.insertBefore(link,actions.firstChild);card.dataset.paymentActions='true';
  });
}
const observer=new MutationObserver(enhance);
function install(){const list=document.getElementById('ordersList');if(!list)return false;observer.observe(list,{childList:true,subtree:true});enhance();return true;}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
let tries=0,t=setInterval(()=>{tries++;if(install()||tries>50)clearInterval(t)},100);
})();

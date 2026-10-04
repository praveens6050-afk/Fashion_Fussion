(function(){'use strict';
if(window.__ffUpiMdrPolicy)return;window.__ffUpiMdrPolicy=true;
function mount(){const panel=document.getElementById('adminSellerFinancePanel');if(!panel||document.getElementById('ffUpiMdrPolicy'))return;const box=document.createElement('div');box.id='ffUpiMdrPolicy';box.className='status show ok';box.style.margin='12px 16px 0';box.textContent='UPI merchant MDR policy: from 15 Oct 2026, eligible UPI merchant payments above ₹2,000 use 0.4% payment-processing MDR (max ₹300). Actual provider fee takes precedence. This is a merchant settlement cost and must never be added to customer checkout.';panel.querySelector('.card-body')?.prepend(box)}
const observer=new MutationObserver(mount);observer.observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();

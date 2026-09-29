(function(){
'use strict';
function normalizeKycMessaging(){
  const status=document.getElementById('kycStatus');
  if(status)status.textContent='Integration pending';

  const view=document.getElementById('view-profile');
  if(!view)return;
  const cards=[...view.querySelectorAll('.status-card')];
  const setup=cards.find(card=>card.querySelector('h3')?.textContent.trim()==='Account setup');
  const kyc=cards.find(card=>card.querySelector('h3')?.textContent.trim()==='KYC & business documents');

  const setupCopy=setup?.querySelector('.progress + p');
  if(setupCopy)setupCopy.textContent='KYC, bank and logistics verification are not enabled yet. They will be required before seller order settlements are activated.';

  if(kyc){
    const items=[...kyc.querySelectorAll('.kyc-item')];
    items.forEach(item=>{
      const label=item.querySelector('div span');
      const tag=item.querySelector('.tag');
      if(label&&label.textContent.trim()==='Verification pending')label.textContent='Verification integration pending';
      if(tag){tag.textContent='Not enabled';tag.classList.add('pending')}
    });
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',normalizeKycMessaging,{once:true});else normalizeKycMessaging();
})();

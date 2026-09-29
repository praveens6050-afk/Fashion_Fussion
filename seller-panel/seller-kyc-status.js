(function(){
'use strict';
function normalizeKycMessaging(){
  const status=document.getElementById('kycStatus');
  if(status)status.textContent='Setup required';

  const view=document.getElementById('view-profile');
  if(!view)return;
  const cards=[...view.querySelectorAll('.status-card')];
  const setup=cards.find(card=>card.querySelector('h3')?.textContent.trim()==='Account setup');
  const kyc=cards.find(card=>card.querySelector('h3')?.textContent.trim()==='KYC & business documents');

  const setupCopy=setup?.querySelector('.progress + p');
  if(setupCopy)setupCopy.textContent='Business identity, payout account and pickup details can be submitted below for Fashion_Fussion admin review. External KYC and bank-provider verification are not connected yet.';

  if(kyc){
    const items=[...kyc.querySelectorAll('.kyc-item')];
    items.forEach(item=>{
      const label=item.querySelector('div span');
      const tag=item.querySelector('.tag');
      if(label&&label.textContent.trim()==='Verification pending')label.textContent='Complete in live onboarding below';
      if(tag){tag.textContent='Set up below';tag.classList.add('pending')}
    });
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',normalizeKycMessaging,{once:true});else normalizeKycMessaging();
})();

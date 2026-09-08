(function(){
  'use strict';
  function disableCod(){
    const cod=document.querySelector('input[name="paymentMethod"][value="cod"]');
    if(!cod)return;
    const prepaid=document.querySelector('input[name="paymentMethod"][value="prepaid"]');
    if(cod.checked&&prepaid)prepaid.checked=true;
    cod.checked=false;
    cod.disabled=true;
    const label=cod.closest('.pay-option');
    if(label){
      label.style.display='none';
      label.setAttribute('aria-hidden','true');
    }
    cod.dispatchEvent(new Event('change',{bubbles:true}));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',disableCod,{once:true});
  else disableCod();
})();

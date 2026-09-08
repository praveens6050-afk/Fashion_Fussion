(function(){
  'use strict';
  function fixBrand(){
    if((location.pathname.split('/').pop()||'index.html')!=='index.html')return;
    document.title=document.title.replace(/Fashion_FUSSION/g,'Fashion_Fussion');
    document.querySelectorAll('.logo').forEach(function(logo){
      const text=(logo.textContent||'').replace(/\s+/g,'').toLowerCase();
      if(text.includes('fashion_fussion')||text.includes('fashion_fussion')){
        logo.innerHTML='Fashion<small>_Fussion</small>';
      }
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fixBrand);else fixBrand();
  new MutationObserver(fixBrand).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
})();
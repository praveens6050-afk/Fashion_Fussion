(function(){
  'use strict';
  function fixBrand(){
    if((location.pathname.split('/').pop()||'index.html')!=='index.html') return;
    if(document.title.includes('Fashion_FUSSION')){
      document.title=document.title.replace(/Fashion_FUSSION/g,'Fashion_Fussion');
    }
    document.querySelectorAll('.logo').forEach(function(logo){
      const text=(logo.textContent||'').replace(/\s+/g,'').toLowerCase();
      if(!text.includes('fashion_fussion')) return;
      const expected='Fashion<small>_Fussion</small>';
      if(logo.innerHTML!==expected) logo.innerHTML=expected;
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fixBrand,{once:true});
  else fixBrand();
})();
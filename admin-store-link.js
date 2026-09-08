(function(){
  'use strict';
  function init(){
    if((location.pathname.split('/').pop()||'')!=='admin.html')return;
    document.querySelectorAll('a').forEach(a=>{
      const text=(a.textContent||'').trim().toLowerCase();
      const href=(a.getAttribute('href')||'').split('?')[0].split('#')[0];
      if(text==='store' || href==='index.html'){
        a.setAttribute('href','index.html?admin_preview=1');
        a.setAttribute('title','Preview customer storefront');
      }
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
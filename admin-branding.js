(function(){
  'use strict';
  function fix(){
    if((location.pathname.split('/').pop()||'')!=='admin.html')return;
    document.title=document.title.replace(/Fashion_FUSSION/g,'Fashion_Fussion');
    const logo=document.querySelector('.logo');
    if(logo){
      logo.innerHTML='Fashion<span>_Fussion</span>';
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fix);else fix();
})();
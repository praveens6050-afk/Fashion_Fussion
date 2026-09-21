(function(){'use strict';
  if(window.__ffCustomerBrowserCompat)return;
  window.__ffCustomerBrowserCompat=true;
  var root=document.documentElement;
  var raw=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  var page=raw.replace(/\.html$/,'').replace(/[^a-z0-9-]+/g,'-')||'index';
  root.classList.add('ff-customer-compat','ff-page-'+page);
  var ua=navigator.userAgent||'';
  var isiOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(isiOS)root.classList.add('ff-ios');
  if(/Safari/i.test(ua)&&!/Chrome|CriOS|Edg|OPR|Android/i.test(ua))root.classList.add('ff-safari');
  var viewport=document.querySelector('meta[name="viewport"]');
  if(!viewport){viewport=document.createElement('meta');viewport.name='viewport';document.head.appendChild(viewport)}
  viewport.setAttribute('content','width=device-width,initial-scale=1,viewport-fit=cover');
  function syncViewport(){
    var h=(window.visualViewport&&window.visualViewport.height)||window.innerHeight||0;
    var w=(window.visualViewport&&window.visualViewport.width)||window.innerWidth||0;
    if(h)root.style.setProperty('--ff-viewport-height',h+'px');
    if(w)root.style.setProperty('--ff-viewport-width',w+'px');
    root.style.setProperty('--ff-vh',(h*.01)+'px');
  }
  syncViewport();
  var raf=0;function requestSync(){cancelAnimationFrame(raf);raf=requestAnimationFrame(syncViewport)}
  window.addEventListener('resize',requestSync,{passive:true});
  window.addEventListener('orientationchange',requestSync,{passive:true});
  if(window.visualViewport){window.visualViewport.addEventListener('resize',requestSync,{passive:true});window.visualViewport.addEventListener('scroll',requestSync,{passive:true})}
})();

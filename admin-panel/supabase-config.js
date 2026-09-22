const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.FF_API_ORIGIN='';
(function(){'use strict';
  const SDK_FALLBACK='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
  const SDK_INTEGRITY='sha384-iLddHTLokph6Omwoyid4XKxHaWa6w41BnoEj0q5oOrzmYPpHIKt1wyjReA7s//pP';
  function createClient(){
    if(window.supabaseClient)return window.supabaseClient;
    if(!window.supabase||typeof window.supabase.createClient!=='function')return null;
    window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    return window.supabaseClient;
  }
  function loadFallback(){
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-admin-supabase-fallback]');
      if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('Supabase SDK could not be loaded')),{once:true});return}
      const script=document.createElement('script');
      script.src=SDK_FALLBACK;
      script.integrity=SDK_INTEGRITY;
      script.crossOrigin='anonymous';
      script.async=false;
      script.setAttribute('data-admin-supabase-fallback','true');
      script.onload=resolve;
      script.onerror=()=>reject(new Error('Supabase SDK could not be loaded'));
      document.head.appendChild(script);
    });
  }
  window.ffAdminSupabaseReady=(async()=>{
    let client=createClient();
    if(client)return client;
    await loadFallback();
    client=createClient();
    if(!client)throw new Error('Supabase client is unavailable');
    return client;
  })();

  function add(src,marker){if(document.querySelector('script['+marker+']'))return;const s=document.createElement('script');s.src=src;s.async=false;s.setAttribute(marker,'true');document.head.appendChild(s)}
  const page=(location.pathname.split('/').filter(Boolean).pop()||'login').toLowerCase();
  const isAdminPage=page==='admin'||page==='admin.html';
  function loadAdminModules(){
    add('admin-notifications.js?v=2','data-admin-notifications');
    add('support-chat.js?v=10','data-support-chat');
    add('admin-orders.js?v=2','data-admin-orders');
    add('admin-promotions.js?v=2','data-admin-promotions');
    add('admin-returns.js?v=1','data-admin-returns');
    add('admin-business-quotes.js?v=3','data-admin-business-quotes');
    add('admin-inventory.js?v=2','data-admin-inventory');
    add('admin-catalog-safety.js?v=1','data-admin-catalog-safety');
    add('admin-shipping.js?v=2','data-admin-shipping');
    add('admin-shipping-health.js?v=1','data-admin-shipping-health');
    add('admin-checkout-health.js?v=2','data-admin-checkout-health');
    add('admin-launch-readiness.js?v=2','data-admin-launch-readiness');
    add('admin-seller-approvals.js?v=1','data-admin-seller-approvals');
    add('admin-owner-center.js?v=2','data-admin-owner-center');
  }
  function start(){
    if(!isAdminPage)return;
    const dashboard=document.getElementById('dashboard');
    if(!dashboard)return;
    if(dashboard.dataset.adminReady==='true'){loadAdminModules();return}
    const observer=new MutationObserver(()=>{
      if(dashboard.dataset.adminReady!=='true')return;
      observer.disconnect();
      loadAdminModules();
    });
    observer.observe(dashboard,{attributes:true,attributeFilter:['data-admin-ready']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
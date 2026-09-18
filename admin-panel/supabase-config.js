const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.FF_API_ORIGIN='';
window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
(function(){'use strict';
  function add(src,marker){if(document.querySelector('script['+marker+']'))return;const s=document.createElement('script');s.src=src;s.async=false;s.setAttribute(marker,'true');document.head.appendChild(s)}
  const page=(location.pathname.split('/').pop()||'login.html').toLowerCase();
  function start(){
    if(page!=='admin.html')return;
    add('admin-notifications.js?v=2','data-admin-notifications');
    add('support-chat.js?v=9','data-support-chat');
    add('admin-orders.js?v=2','data-admin-orders');
    add('admin-promotions.js?v=2','data-admin-promotions');
    add('admin-returns.js?v=1','data-admin-returns');
    add('admin-business-quotes.js?v=3','data-admin-business-quotes');
    add('admin-inventory.js?v=1','data-admin-inventory');
    add('admin-catalog-safety.js?v=1','data-admin-catalog-safety');
    add('admin-shipping.js?v=2','data-admin-shipping');
    add('admin-shipping-health.js?v=1','data-admin-shipping-health');
    add('admin-checkout-health.js?v=1','data-admin-checkout-health');
    add('admin-launch-readiness.js?v=1','data-admin-launch-readiness');
    add('admin-seller-approvals.js?v=1','data-admin-seller-approvals');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

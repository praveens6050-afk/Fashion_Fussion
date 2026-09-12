const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
(function(){'use strict';
  function add(src,marker){if(document.querySelector('script['+marker+']'))return;const s=document.createElement('script');s.src=src;s.async=false;s.setAttribute(marker,'true');document.head.appendChild(s)}
  function start(){
    const page=location.pathname.split('/').pop()||'index.html';
    if(page==='account.html'){add('account-role-guard.js?v=2','data-account-role-guard');add('support-chat.js?v=8','data-support-chat');add('account-refunds.js?v=1','data-account-refunds');add('account-returns.js?v=1','data-account-returns');add('account-business.js?v=1','data-account-business');add('account-repeat-order.js?v=1','data-account-repeat-order')}
    if(page==='order-details.html'){add('order-refund-tracker.js?v=1','data-order-refund-tracker');add('order-return-exchange.js?v=1','data-order-return-exchange')}
    if(page==='cart.html'){add('commerce-bulk-display.js?v=1','data-commerce-bulk-display')}
    if(page==='checkout.html'){add('commerce-bulk-display.js?v=1','data-commerce-bulk-display');add('checkout-business.js?v=1','data-checkout-business')}
    if(page==='index.html'){add('support-chat.js?v=8','data-support-chat')}
    if(page==='admin.html'){add('admin-notifications.js?v=2','data-admin-notifications');add('support-chat.js?v=8','data-support-chat');add('admin-orders.js?v=2','data-admin-orders');add('admin-promotions.js?v=2','data-admin-promotions');add('admin-returns.js?v=1','data-admin-returns');add('admin-business-quotes.js?v=1','data-admin-business-quotes')}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start()
})();

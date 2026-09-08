const SUPABASE_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function loadCustomerScripts(){
  function add(src, marker){
    if(document.querySelector('script['+marker+']')) return;
    const script=document.createElement('script');
    script.src=src;
    script.defer=false;
    script.setAttribute(marker,'true');
    document.head.appendChild(script);
  }
  function start(){
    const page=window.location.pathname.split('/').pop()||'index.html';
    if(new Set(['index.html','account.html','admin.html']).has(page)) add('support-chat.js?v=4','data-support-chat');
    if(page==='account.html'){
      add('customer-addresses.js?v=2','data-customer-addresses');
      add('account-dashboard.js?v=5','data-account-dashboard');
      add('order-tracking.js?v=2','data-order-tracking');
    }
    if(page==='admin.html'){
      add('admin-orders.js?v=1','data-admin-orders');
      add('admin-promotions.js?v=1','data-admin-promotions');
    }
    if(page==='index.html'){
      add('checkout-address.js?v=3','data-checkout-address');
      add('customer-account-menu.js?v=2','data-customer-account-menu');
      add('cart-navigation.js?v=1','data-cart-navigation');
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
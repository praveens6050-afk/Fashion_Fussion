const SUPABASE_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function loadPageScripts(){
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

    // Customer-only behavior. Never load these account/store helpers on admin.html.
    if(page==='account.html'){
      add('support-chat.js?v=5','data-support-chat');
      add('customer-addresses.js?v=2','data-customer-addresses');
      add('account-dashboard.js?v=5','data-account-dashboard');
      add('order-tracking.js?v=3','data-order-tracking');
    }
    if(page==='index.html'){
      add('storefront-consistency.js?v=1','data-storefront-consistency');
      add('support-chat.js?v=5','data-support-chat');
      add('checkout-address.js?v=3','data-checkout-address');
      add('customer-account-menu.js?v=3','data-customer-account-menu');
      add('cart-navigation.js?v=1','data-cart-navigation');
    }

    // Admin-only behavior. Admin page gets only admin modules plus the admin support inbox.
    if(page==='admin.html'){
      add('support-chat.js?v=5','data-support-chat');
      add('admin-orders.js?v=1','data-admin-orders');
      add('admin-promotions.js?v=1','data-admin-promotions');
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
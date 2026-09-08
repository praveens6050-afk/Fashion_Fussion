const SUPABASE_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function loadPageScripts(){
  function add(src, marker){
    if(document.querySelector('script['+marker+']')) return;
    const script=document.createElement('script');
    script.src=src;
    script.async=false;
    script.setAttribute(marker,'true');
    document.head.appendChild(script);
  }
  function forceStorefrontCopy(){
    const root=document.body;if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      const old=node.nodeValue||'';
      const next=old.replace(/₹599/g,'₹299').replace(/9am\s*[–-]\s*7pm/gi,'24/7');
      if(next!==old)node.nodeValue=next;
    }
  }
  function start(){
    const page=window.location.pathname.split('/').pop()||'index.html';
    if(page==='account.html'){
      add('account-role-guard.js?v=1','data-account-role-guard');
      add('support-chat.js?v=7','data-support-chat');
      add('customer-addresses.js?v=2','data-customer-addresses');
      add('account-dashboard.js?v=5','data-account-dashboard');
      add('order-tracking.js?v=3','data-order-tracking');
    }
    if(page==='index.html'){
      forceStorefrontCopy();
      new MutationObserver(forceStorefrontCopy).observe(document.body,{childList:true,subtree:true,characterData:true});
      add('storefront-consistency.js?v=3','data-storefront-consistency');
      add('support-chat.js?v=7','data-support-chat');
      add('checkout-address.js?v=3','data-checkout-address');
      add('customer-account-menu.js?v=5','data-customer-account-menu');
      add('cart-navigation.js?v=1','data-cart-navigation');
    }
    if(page==='admin.html'){
      add('admin-store-link.js?v=2','data-admin-store-link');
      add('support-chat.js?v=7','data-support-chat');
      add('admin-orders.js?v=1','data-admin-orders');
      add('admin-promotions.js?v=1','data-admin-promotions');
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
(function(){'use strict';
  function add(src,marker){if(document.querySelector('script['+marker+']'))return;const s=document.createElement('script');s.src=src;s.async=false;s.setAttribute(marker,'true');document.head.appendChild(s)}
  const page=location.pathname.split('/').pop()||'index.html';
  if(['index.html','search.html','wishlist.html','product.html','cart.html','checkout.html'].includes(page))add('variant-commerce.js?v=2','data-variant-commerce');
  if(['index.html','search.html','wishlist.html'].includes(page))add('catalog-cart-entry.js?v=1','data-catalog-cart-entry');
  function start(){
    if(['index.html','account.html','quote-checkout.html'].includes(page))add('business-registration-trust.js?v=2','data-business-registration-trust');
    if(page==='product.html')add('product-variants.js?v=2','data-product-variants');
    if(['cart.html','checkout.html'].includes(page))add('variant-cart-ui.js?v=1','data-variant-cart-ui');
    if(page==='account.html'){add('account-stability.js?v=1','data-account-stability');add('account-role-guard.js?v=2','data-account-role-guard');add('support-chat.js?v=8','data-support-chat');add('account-refunds.js?v=1','data-account-refunds');add('account-returns.js?v=2','data-account-returns');add('account-business.js?v=4','data-account-business');add('account-repeat-order.js?v=1','data-account-repeat-order');add('account-cancel-promotion.js?v=1','data-account-cancel-promotion')}
    if(page==='order-details.html'){add('order-refund-tracker.js?v=1','data-order-refund-tracker');add('order-return-exchange.js?v=1','data-order-return-exchange');add('order-business-details.js?v=1','data-order-business-details');add('order-cancel-promotion.js?v=1','data-order-cancel-promotion');add('order-shipping.js?v=1','data-order-shipping')}
    if(page==='order-confirmation.html'){add('order-business-details.js?v=1','data-order-business-details')}
    if(page==='cart.html'){add('commerce-bulk-display.js?v=1','data-commerce-bulk-display')}
    if(page==='checkout.html'){add('commerce-bulk-display.js?v=1','data-commerce-bulk-display');add('checkout-business.js?v=1','data-checkout-business')}
    if(page==='index.html'){add('support-chat.js?v=8','data-support-chat')}
    if(page==='admin.html'){add('admin-notifications.js?v=2','data-admin-notifications');add('support-chat.js?v=8','data-support-chat');add('admin-orders.js?v=2','data-admin-orders');add('admin-promotions.js?v=2','data-admin-promotions');add('admin-returns.js?v=1','data-admin-returns');add('admin-business-quotes.js?v=3','data-admin-business-quotes');add('admin-inventory.js?v=1','data-admin-inventory');add('admin-catalog-safety.js?v=1','data-admin-catalog-safety');add('admin-shipping.js?v=2','data-admin-shipping');add('admin-shipping-health.js?v=1','data-admin-shipping-health');add('admin-checkout-health.js?v=1','data-admin-checkout-health');add('admin-launch-readiness.js?v=1','data-admin-launch-readiness')}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start()
})();
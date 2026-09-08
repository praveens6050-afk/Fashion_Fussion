const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
(function(){'use strict';
  const page=location.pathname.split('/').pop()||'index.html';
  if(page==='admin.html'){
    const originalFetch=window.fetch.bind(window);
    const costEndpoint='https://fashion-fussion-olive.vercel.app/api/admin-product-costs';
    window.fetch=async function(input,init){
      const url=typeof input==='string'?input:String(input&&input.url||'');
      if(url!==costEndpoint)return originalFetch(input,init);
      let response;
      try{response=await originalFetch(input,init);if(response.ok)return response}catch(error){console.warn('Private admin cost API unavailable; trying compatibility fallback.',error)}
      try{
        const {data,error}=await window.supabaseClient.from('products').select('id,cost').order('id',{ascending:true});
        if(error)throw error;
        return new Response(JSON.stringify({products:data||[],compatibility_fallback:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
      }catch(error){
        console.error('Admin cost compatibility fallback failed:',error);
        if(response)return response;
        return new Response(JSON.stringify({error:'Could not load private product costs'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8'}});
      }
    };
  }
  function add(src,marker){if(document.querySelector('script['+marker+']'))return;const s=document.createElement('script');s.src=src;s.async=false;s.setAttribute(marker,'true');document.head.appendChild(s)}
  function start(){
    const page=location.pathname.split('/').pop()||'index.html';
    if(page==='account.html'){add('account-role-guard.js?v=2','data-account-role-guard');add('support-chat.js?v=8','data-support-chat');add('customer-addresses.js?v=3','data-customer-addresses');add('account-dashboard.js?v=6','data-account-dashboard');add('order-tracking.js?v=4','data-order-tracking')}
    if(page==='index.html'){add('support-chat.js?v=8','data-support-chat')}
    if(page==='checkout.html'){add('checkout-address-compat.js?v=1','data-checkout-address-compat');add('checkout-cod-guard.js?v=1','data-checkout-cod-guard')}
    if(page==='admin.html'){add('admin-notifications.js?v=2','data-admin-notifications');add('support-chat.js?v=8','data-support-chat');add('admin-orders.js?v=2','data-admin-orders');add('admin-promotions.js?v=2','data-admin-promotions')}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start()
})();

'use strict';
const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const sellerPath=(location.pathname.split('/').pop()||'index.html').toLowerCase();
const isSellerLogin=sellerPath==='login'||sellerPath==='login.html';
if(!isSellerLogin){
  document.documentElement.classList.add('seller-live-loading');
  if(!document.getElementById('seller-live-bootstrap-style')){const style=document.createElement('style');style.id='seller-live-bootstrap-style';style.textContent='.seller-live-loading body{visibility:hidden}';document.head.appendChild(style)}
  if(!document.querySelector('script[data-seller-launch-safety]')){const guard=document.createElement('script');guard.src='seller-launch-safety.js';guard.async=false;guard.setAttribute('data-seller-launch-safety','true');document.head.appendChild(guard)}
  if(!localStorage.getItem('ff_seller_session_v1')&&!sessionStorage.getItem('ff_seller_session_v1'))sessionStorage.setItem('ff_seller_session_v1',JSON.stringify({sellerId:'LIVE',storeName:'Seller',email:'',name:'Seller',authProvider:'supabase-pending'}));
  if(!window.__sellerLiveIntegrationRequested){window.__sellerLiveIntegrationRequested=true;const script=document.createElement('script');script.src='seller-live-integration.js';script.async=false;document.head.appendChild(script)}
}

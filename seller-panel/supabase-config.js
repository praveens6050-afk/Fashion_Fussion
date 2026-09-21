'use strict';
const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
const SUPABASE_SRI='sha384-iLddHTLokph6Omwoyid4XKxHaWa6w41BnoEj0q5oOrzmYPpHIKt1wyjReA7s//pP';
const SUPABASE_FALLBACK_URL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';

function createSellerSupabaseClient(){
  if(window.supabaseClient)return window.supabaseClient;
  if(!window.supabase||typeof window.supabase.createClient!=='function')return null;
  window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return window.supabaseClient;
}

function loadPinnedSellerSdk(src){
  return new Promise((resolve,reject)=>{
    const existing=[...document.scripts].find(script=>script.src===src);
    if(existing){
      if(window.supabase&&typeof window.supabase.createClient==='function'){resolve();return}
      existing.addEventListener('load',()=>resolve(),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Supabase SDK failed to load')),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src=src;
    script.integrity=SUPABASE_SRI;
    script.crossOrigin='anonymous';
    script.referrerPolicy='no-referrer';
    script.onload=()=>resolve();
    script.onerror=()=>reject(new Error('Supabase SDK failed to load'));
    document.head.appendChild(script);
  });
}

window.ffSellerSupabaseReady=(async()=>{
  let client=createSellerSupabaseClient();
  if(client)return client;
  try{
    await loadPinnedSellerSdk(SUPABASE_FALLBACK_URL);
    client=createSellerSupabaseClient();
    if(client)return client;
  }catch(error){
    console.error('[Seller Center] Supabase fallback load failed',error);
  }
  throw new Error('Seller services could not start. Check your connection and reload the page.');
})();
window.ffSupabaseReady=window.ffSellerSupabaseReady;

const sellerPath=(location.pathname.split('/').pop()||'index.html').toLowerCase();
const isSellerLogin=sellerPath==='login'||sellerPath==='login.html';
if(!isSellerLogin){
  document.documentElement.classList.add('seller-live-loading');
  if(!document.getElementById('seller-live-bootstrap-style')){const style=document.createElement('style');style.id='seller-live-bootstrap-style';style.textContent='.seller-live-loading body{visibility:hidden}';document.head.appendChild(style)}
  if(!document.querySelector('script[data-seller-launch-safety]')){const guard=document.createElement('script');guard.src='seller-launch-safety.js';guard.async=false;guard.setAttribute('data-seller-launch-safety','true');document.head.appendChild(guard)}
  if(!localStorage.getItem('ff_seller_session_v1')&&!sessionStorage.getItem('ff_seller_session_v1'))sessionStorage.setItem('ff_seller_session_v1',JSON.stringify({sellerId:'LIVE',storeName:'Seller',email:'',name:'Seller',authProvider:'supabase-pending'}));
}

window.ffSellerSupabaseReady.then(()=>{
  if(isSellerLogin||window.SellerLiveIntegration)return;
  window.__sellerLiveIntegrationBooted=false;
  if(document.querySelector('script[data-seller-live-recovery]'))return;
  const script=document.createElement('script');
  script.src='seller-live-integration.js?v=20260921-supabase-recovery';
  script.async=false;
  script.setAttribute('data-seller-live-recovery','true');
  document.body.appendChild(script);
}).catch(error=>{
  console.error('[Seller Center] Supabase startup failed',error);
  document.documentElement.classList.remove('seller-live-loading');
});

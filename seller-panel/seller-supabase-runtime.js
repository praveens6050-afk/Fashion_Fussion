'use strict';
(()=>{
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const target=(page==='login'||page==='login.html')?'auth.js?v=20260921-supabase-recovery':'seller-live-integration.js?v=20260921-supabase-recovery';

  function showStartupError(error){
    console.error('[Seller Center] Startup failed',error);
    document.documentElement.classList.remove('seller-live-loading');
    const message='Seller services are temporarily unavailable. Check your connection and reload.';
    const authMessage=document.getElementById('authMessage');
    if(authMessage){authMessage.textContent=message;authMessage.className='auth-message err';return}
    const toast=document.getElementById('toast');
    if(toast){toast.textContent=message;toast.classList.add('show');return}
    const box=document.createElement('div');
    box.setAttribute('role','alert');
    box.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;padding:14px 16px;border-radius:10px;background:#7f1d1d;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px #0003';
    box.textContent=message;
    document.body.appendChild(box);
  }

  const ready=window.ffSellerSupabaseReady||window.ffSupabaseReady||Promise.resolve(window.supabaseClient);
  Promise.resolve(ready).then(client=>{
    if(!client)throw new Error('Supabase client is unavailable');
    if(document.querySelector('script[data-seller-supabase-target]'))return;
    const script=document.createElement('script');
    script.src=target;
    script.async=false;
    script.setAttribute('data-seller-supabase-target','true');
    script.onerror=()=>showStartupError(new Error('Seller runtime failed to load'));
    document.body.appendChild(script);
  }).catch(showStartupError);
})();

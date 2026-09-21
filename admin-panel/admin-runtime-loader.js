'use strict';
(()=>{
  const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
  Promise.resolve(ready).then(client=>{
    if(!client?.auth)throw new Error('Admin authentication service is unavailable.');
    if(document.querySelector('script[data-admin-core-runtime]'))return;
    const script=document.createElement('script');
    script.src='csp-admin.js?v=20260921-admin-supabase-recovery';
    script.async=false;
    script.setAttribute('data-admin-core-runtime','true');
    script.onerror=()=>{
      const denied=document.getElementById('accessDenied');
      const loading=document.getElementById('loadingScreen');
      const message=document.getElementById('accessDeniedMessage');
      if(loading)loading.hidden=true;
      if(denied)denied.hidden=false;
      if(message)message.textContent='Admin dashboard could not be loaded.';
    };
    document.body.appendChild(script);
  }).catch(error=>{
    console.error('[Admin] Supabase startup failed',error);
    const denied=document.getElementById('accessDenied');
    const loading=document.getElementById('loadingScreen');
    const message=document.getElementById('accessDeniedMessage');
    if(loading)loading.hidden=true;
    if(denied)denied.hidden=false;
    if(message)message.textContent='Admin authentication service is temporarily unavailable.';
  });
})();

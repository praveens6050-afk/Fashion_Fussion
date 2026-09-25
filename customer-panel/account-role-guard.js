(function(){
  'use strict';
  const leaf=location.pathname.replace(/\/+$/,'').split('/').pop()||'account';
  const page=leaf.includes('.')?leaf:leaf+'.html';
  if(page==='account.html'&&!document.querySelector('script[data-desktop-account-loader]')){
    const s=document.createElement('script');
    s.src='desktop-account-loader.js?v=1';
    s.async=false;
    s.setAttribute('data-desktop-account-loader','true');
    document.head.appendChild(s);
  }
  if(!window.supabaseClient)return;

  function adminTarget(){
    const origin=String(window.FF_ADMIN_ORIGIN||'https://admin.fashionfussion.in').replace(/\/+$/,'');
    return origin+'/';
  }

  async function resolvedUser(){
    const {data:{user},error}=await window.supabaseClient.auth.getUser();
    if(user)return user;
    if(error){
      try{
        const {data:{session}}=await window.supabaseClient.auth.getSession();
        return session?.user||null;
      }catch{}
    }
    return null;
  }

  async function guard(){
    try{
      const user=await resolvedUser();
      if(!user)return;

      const {data:profile,error}=await window.supabaseClient
        .from('profiles')
        .select('is_admin')
        .eq('id',user.id)
        .maybeSingle();

      if(error){
        console.error('Account role guard error:',error);
        return;
      }

      if(profile?.is_admin===true){
        window.location.replace(adminTarget());
      }
    }catch(error){
      console.error('Account role guard failed:',error);
    }
  }

  guard();
})();
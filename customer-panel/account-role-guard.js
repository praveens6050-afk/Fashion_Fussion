(function(){
  'use strict';
  if((location.pathname.split('/').pop()||'index.html')==='account.html'&&!document.querySelector('script[data-desktop-account-loader]')){
    const s=document.createElement('script');
    s.src='desktop-account-loader.js?v=1';
    s.async=false;
    s.setAttribute('data-desktop-account-loader','true');
    document.head.appendChild(s);
  }
  if(!window.supabaseClient)return;

  async function guard(){
    try{
      const {data:{user}}=await window.supabaseClient.auth.getUser();
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
        window.location.replace('admin.html');
      }
    }catch(error){
      console.error('Account role guard failed:',error);
    }
  }

  guard();
})();
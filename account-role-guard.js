(function(){
  'use strict';
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
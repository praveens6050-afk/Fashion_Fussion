(async function(){
  const loading=document.getElementById('loading'),content=document.getElementById('content'),errorBox=document.getElementById('errorBox');
  function fail(msg){loading.hidden=true;content.hidden=true;errorBox.hidden=false;errorBox.textContent=msg;}
  try{
    const sessionResult=await window.supabaseClient.auth.getSession();
    let user=sessionResult?.data?.session?.user||null;
    if(!user){const userResult=await window.supabaseClient.auth.getUser();user=userResult?.data?.user||null;}
    if(!user){location.replace('/login');return;}
    const {data:profile,error:profileError}=await window.supabaseClient.from('profiles').select('full_name,phone,is_admin').eq('id',user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.is_admin){await window.supabaseClient.auth.signOut();location.replace('/login');return;}
    document.getElementById('fullName').value=profile.full_name||'';
    document.getElementById('phone').value=profile.phone||'';
    document.getElementById('email').value=user.email||'';
    loading.hidden=true;content.hidden=false;
  }catch(e){fail(e.message||'Unable to load admin account.');}
  document.getElementById('logoutBtn').onclick=async()=>{await window.supabaseClient.auth.signOut();location.href='/login';};
})();
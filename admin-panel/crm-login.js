'use strict';
(function(){
  const form=document.getElementById('form'),email=document.getElementById('email'),password=document.getElementById('password'),submit=document.getElementById('submit'),banner=document.getElementById('banner');
  const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
  function show(message,type='error'){banner.textContent=message;banner.className='banner show '+type}
  async function client(){const db=await ready;if(!db?.auth)throw new Error('CRM authentication service is unavailable.');return db}
  async function roleFor(db,user){
    if(!user?.id)return null;
    const{data:profile,error:profileError}=await db.from('profiles').select('is_admin').eq('id',user.id).maybeSingle();
    if(!profileError&&profile?.is_admin===true)return 'administrator';
    const{data:member,error}=await db.from('crm_team_members').select('role,is_active').eq('user_id',user.id).maybeSingle();
    if(error||!member||member.is_active!==true||!['customer_support','seller_support','sales','marketing'].includes(member.role))return null;
    return member.role;
  }
  async function routeExisting(){const db=await client();const{data:{session},error}=await db.auth.getSession();if(error||!session?.user)return;if(await roleFor(db,session.user)){location.replace('crm.html');return}await db.auth.signOut();show('This account is not authorized for the CRM. Contact your CRM administrator.')}
  form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;submit.textContent='Verifying…';try{const db=await client();const{data,error}=await db.auth.signInWithPassword({email:email.value.trim(),password:password.value});if(error)throw error;if(!data?.user||!await roleFor(db,data.user)){await db.auth.signOut();throw new Error('This account has no active CRM role. Ask the CRM administrator for access.')}show('Access verified. Opening CRM…','success');location.replace('crm.html')}catch(error){show(error.message||'Unable to sign in.')}finally{submit.disabled=false;submit.textContent='Sign in to CRM'}});
  routeExisting().catch(error=>{console.error('[CRM] Session check failed',error);show('Unable to verify the current session. Please try again.')});
})();

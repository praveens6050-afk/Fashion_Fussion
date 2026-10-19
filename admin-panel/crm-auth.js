'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
  function deny(message){$('loadingScreen').hidden=true;$('dashboard').hidden=true;$('dashboard').dataset.adminReady='false';$('accessDenied').hidden=false;$('accessDeniedMessage').textContent=message}
  async function init(){
    const db=await ready;if(!db?.auth)throw new Error('CRM authentication service is unavailable.');
    const{data:{session},error}=await db.auth.getSession();
    if(error||!session?.user){deny('Please sign in with a Fashion Fussion administrator account.');return}
    const{data:profile,error:profileError}=await db.from('profiles').select('is_admin').eq('id',session.user.id).maybeSingle();
    if(profileError||profile?.is_admin!==true){await db.auth.signOut();deny('This account is not authorized to access the CRM workspace.');return}
    $('crmEmail').textContent=session.user.email||'Administrator';
    $('loadingScreen').hidden=true;$('accessDenied').hidden=true;$('dashboard').hidden=false;
    $('dashboard').dataset.adminReady='true';document.dispatchEvent(new Event('ff-crm-ready'));
    db.auth.onAuthStateChange((event,nextSession)=>{if(event==='SIGNED_OUT'||!nextSession?.user){location.replace('crm-login.html')}});
  }
  $('crmLogout').addEventListener('click',async()=>{const db=await ready;await db.auth.signOut();location.replace('crm-login.html')});
  $('crmGoLogin').addEventListener('click',()=>location.replace('crm-login.html'));
  init().catch(error=>{console.error('[CRM] Access check failed',error);deny('Unable to verify CRM access. Please sign in again.')});
})();

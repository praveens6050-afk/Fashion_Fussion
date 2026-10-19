'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
  function deny(message){$('loadingScreen').hidden=true;$('dashboard').hidden=true;$('dashboard').dataset.adminReady='false';$('accessDenied').hidden=false;$('accessDeniedMessage').textContent=message}
  async function access(db,user){
    if(!user?.id)return null;
    const{data:profile,error:profileError}=await db.from('profiles').select('is_admin').eq('id',user.id).maybeSingle();
    if(!profileError&&profile?.is_admin===true)return 'administrator';
    const{data:member,error:memberError}=await db.from('crm_team_members').select('role,is_active').eq('user_id',user.id).maybeSingle();
    if(memberError||!member||member.is_active!==true||!['customer_support','seller_support','sales','marketing'].includes(member.role))return null;
    return member.role;
  }
  async function init(){
    const db=await ready;if(!db?.auth)throw new Error('CRM authentication service is unavailable.');
    const{data:{session},error}=await db.auth.getSession();
    if(error||!session?.user){deny('Please sign in with your authorized Fashion Fussion CRM account.');return}
    const role=await access(db,session.user);
    if(!role){await db.auth.signOut();deny('This account has no active CRM team access. Ask the CRM administrator to invite and authorize it.');return}
    $('crmEmail').textContent=(session.user.email||'CRM user')+' · '+role;
    $('dashboard').dataset.crmRole=role;
    $('dashboard').dataset.crmDepartment=role;
    $('loadingScreen').hidden=true;$('accessDenied').hidden=true;$('dashboard').hidden=false;
    $('dashboard').dataset.adminReady='true';
    db.auth.onAuthStateChange((event,nextSession)=>{if(event==='SIGNED_OUT'||!nextSession?.user){location.replace('crm-login.html')}});
  }
  $('crmLogout').addEventListener('click',async()=>{const db=await ready;await db.auth.signOut();location.replace('crm-login.html')});
  $('crmGoLogin').addEventListener('click',()=>location.replace('crm-login.html'));
  init().catch(error=>{console.error('[CRM] Access check failed',error);deny('Unable to verify CRM access. Please sign in again.')});
})();

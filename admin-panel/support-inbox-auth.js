'use strict';
(function(){
 const $=id=>document.getElementById(id),ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
 function deny(message){$('loadingScreen').hidden=true;$('dashboard').hidden=true;$('dashboard').dataset.adminReady='false';$('accessDenied').hidden=false;$('accessDeniedMessage').textContent=message}
 async function init(){const db=await ready;if(!db?.auth)throw new Error('CRM authentication service is unavailable.');const{data:{session},error}=await db.auth.getSession();if(error||!session?.user){location.replace('support-login.html');return}
 const{data,error:rpcError}=await db.rpc('admin_crm_whatsapp_support_snapshot');if(rpcError||!data||!data.actor_team){await db.auth.signOut();deny('This account is not assigned to an active support team. Ask a CRM administrator to grant team access.');return}
 $('supportEmail').textContent=session.user.email||'Support team';$('loadingScreen').hidden=true;$('accessDenied').hidden=true;$('dashboard').hidden=false;$('dashboard').dataset.adminReady='true';document.dispatchEvent(new Event('ff-crm-ready'));
 db.auth.onAuthStateChange((event,next)=>{if(event==='SIGNED_OUT'||!next?.user)location.replace('support-login.html')});
 }
 $('supportLogout').addEventListener('click',async()=>{const db=await ready;await db.auth.signOut();location.replace('support-login.html')});
 $('supportGoLogin').addEventListener('click',()=>location.replace('support-login.html'));
 init().catch(error=>{console.error('[Support inbox] Access check failed',error);deny('Unable to verify team access. Please sign in again.')});
})();
'use strict';
(()=>{
const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
const SUPABASE_SRI='sha384-iLddHTLokph6Omwoyid4XKxHaWa6w41BnoEj0q5oOrzmYPpHIKt1wyjReA7s//pP';
const SDK_PRIMARY='https://unpkg.com/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
const SDK_FALLBACK='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
const REMEMBER_KEY='ff_seller_remember_mode';
const UI_SESSION_KEY='ff_seller_session_v1';
const $=id=>document.getElementById(id);
let authBound=false;

function setMessage(message,type=''){const box=$('authMessage');if(!box)return;box.textContent=message;box.className='auth-message '+type}
function syncTabState(mode){document.querySelectorAll('[data-auth-mode]').forEach(button=>{const selected=button.dataset.authMode===mode;button.classList.toggle('active',selected);button.setAttribute('aria-selected',selected?'true':'false');button.tabIndex=selected?0:-1})}
function setMode(mode){syncTabState(mode);$('loginForm').hidden=mode!=='login';$('registerForm').hidden=mode!=='register';$('resetPasswordForm').hidden=mode!=='recovery';const tabs=document.querySelector('.auth-tabs');if(tabs)tabs.hidden=mode==='recovery';$('authTitle').textContent=mode==='login'?'Sign in to Seller Center':mode==='register'?'Create your seller account':'Set a new password';$('authSubtitle').textContent=mode==='login'?'Use your registered seller email and password.':mode==='register'?'Create a seller account for catalog review and approval.':'Choose a new password for your seller account.';setMessage('')}
function setServiceReady(ready){document.querySelectorAll('.auth-submit').forEach(button=>button.disabled=!ready);const forgot=$('forgotPassword');if(forgot)forgot.disabled=!ready}
function isRecoveryUrl(){return location.hash.includes('type=recovery')||location.search.includes('type=recovery')||location.search.includes('recovery=1')}

document.addEventListener('submit',event=>{if(!authBound&&event.target?.classList?.contains('auth-form'))event.preventDefault()},true);
setServiceReady(false);
const storedRemember=localStorage.getItem(REMEMBER_KEY)==='true';if($('rememberMe'))$('rememberMe').checked=storedRemember;
document.querySelectorAll('[data-password-toggle]').forEach(button=>button.addEventListener('click',()=>{const input=$(button.dataset.passwordToggle);if(!input)return;const visible=input.type==='text';input.type=visible?'password':'text';button.textContent=visible?'Show':'Hide';button.setAttribute('aria-pressed',visible?'false':'true')}));
const tabs=[...document.querySelectorAll('[role="tab"][data-auth-mode]')];tabs.forEach((btn,index)=>{btn.addEventListener('click',()=>setMode(btn.dataset.authMode));btn.addEventListener('keydown',event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();tabs[next].focus();setMode(tabs[next].dataset.authMode)})});
if(isRecoveryUrl())setMode('recovery');

const authStorage={
 getItem(key){return (localStorage.getItem(REMEMBER_KEY)==='true'?localStorage:sessionStorage).getItem(key)},
 setItem(key,value){return (localStorage.getItem(REMEMBER_KEY)==='true'?localStorage:sessionStorage).setItem(key,value)},
 removeItem(key){localStorage.removeItem(key);sessionStorage.removeItem(key)}
};
function createClient(){if(window.supabaseClient)return window.supabaseClient;if(!window.supabase||typeof window.supabase.createClient!=='function')return null;window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:authStorage}});return window.supabaseClient}
function loadSdk(src,timeoutMs=6500){return new Promise((resolve,reject)=>{if(window.supabase&&typeof window.supabase.createClient==='function'){resolve();return}const script=document.createElement('script');let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve()};const timer=setTimeout(()=>finish(new Error('Supabase SDK load timed out')),timeoutMs);script.src=src;script.integrity=SUPABASE_SRI;script.crossOrigin='anonymous';script.referrerPolicy='no-referrer';script.async=true;script.onload=()=>finish();script.onerror=()=>finish(new Error('Supabase SDK failed to load'));document.head.appendChild(script)})}
window.ffSellerSupabaseReady=(async()=>{let client=createClient();if(client)return client;for(const src of [SDK_PRIMARY,SDK_FALLBACK]){try{await loadSdk(src);client=createClient();if(client)return client}catch(error){console.warn('[Seller Center] SDK source unavailable',src,error.message)}}throw new Error('Seller services could not start. Check your connection and reload the page.')})();
window.ffSupabaseReady=window.ffSellerSupabaseReady;

async function start(){
 const client=await window.ffSellerSupabaseReady;if(!client)throw new Error('Seller authentication service is unavailable.');
 function cleanPhone(value){return String(value||'').replace(/\D/g,'').slice(-10)}
 function rememberEnabled(){return Boolean($('rememberMe')?.checked)}
 function persistRememberChoice(value){localStorage.setItem(REMEMBER_KEY,value?'true':'false')}
 function recoveryUrl(){return location.origin+'/login.html?recovery=1'}
 async function sellerProfile(user){const{data,error}=await client.from('seller_profiles').select('user_id,seller_code,store_name,seller_type,phone,status').eq('user_id',user.id).maybeSingle();if(error)throw error;return data}
 async function ensureSellerProfile(user){let profile=await sellerProfile(user);if(profile)return profile;const meta=user.user_metadata||{};if(!meta.seller_registration_intent)throw new Error('This account is not registered as a seller.');const{data,error}=await client.rpc('register_seller_profile',{p_store_name:meta.store_name||'Seller Store',p_seller_type:meta.seller_type||'individual',p_phone:meta.phone||null});if(error)throw error;return Array.isArray(data)?data[0]:data}
 function setUiSession(user,profile,remember=localStorage.getItem(REMEMBER_KEY)==='true'){const meta=user.user_metadata||{},name=meta.full_name||user.email?.split('@')[0]||'Seller';const payload=JSON.stringify({sellerId:user.id,sellerCode:profile.seller_code||'',email:user.email,storeName:profile.store_name,name,createdAt:new Date().toISOString(),authProvider:'supabase'});localStorage.removeItem(UI_SESSION_KEY);sessionStorage.removeItem(UI_SESSION_KEY);(remember?localStorage:sessionStorage).setItem(UI_SESSION_KEY,payload)}
 async function finishLogin(user,remember=localStorage.getItem(REMEMBER_KEY)==='true'){const profile=await ensureSellerProfile(user);if(profile?.status!=='active')throw new Error('Seller account is not active.');setUiSession(user,profile,remember);location.href='index.html'}

 client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')setMode('recovery')});
 if(!isRecoveryUrl()){try{const{data:{session}}=await client.auth.getSession();if(session?.user){try{await finishLogin(session.user,storedRemember)}catch{await client.auth.signOut();localStorage.removeItem(UI_SESSION_KEY);sessionStorage.removeItem(UI_SESSION_KEY)}}}catch(error){console.warn('[Seller Center] Session restore failed',error)}}

 $('forgotPassword')?.addEventListener('click',async()=>{const email=$('loginEmail').value.trim().toLowerCase();if(!email){setMessage('Enter your registered seller email first.','err');$('loginEmail').focus();return}const button=$('forgotPassword');button.disabled=true;setMessage('Sending password reset link…');try{const{error}=await client.auth.resetPasswordForEmail(email,{redirectTo:recoveryUrl()});if(error)throw error;setMessage('Password reset link sent. Check your email.','ok')}catch(error){setMessage(error.message||'Could not send password reset email.','err')}finally{button.disabled=false}});
 $('loginForm').addEventListener('submit',async event=>{event.preventDefault();const btn=$('loginSubmit'),remember=rememberEnabled();persistRememberChoice(remember);btn.disabled=true;setMessage('Signing in…');try{const{data,error}=await client.auth.signInWithPassword({email:$('loginEmail').value.trim().toLowerCase(),password:$('loginPassword').value});if(error)throw error;await finishLogin(data.user,remember)}catch(error){await client.auth.signOut().catch(()=>{});localStorage.removeItem(UI_SESSION_KEY);sessionStorage.removeItem(UI_SESSION_KEY);setMessage(error.message||'Seller sign in failed.','err')}finally{btn.disabled=false}});
 $('registerForm').addEventListener('submit',async event=>{event.preventDefault();const btn=$('registerSubmit'),mobile=cleanPhone($('mobile').value),storeName=$('storeName').value.trim(),password=$('registerPassword').value;if(mobile.length!==10){setMessage('Enter a valid 10-digit mobile number.','err');return}if(storeName.length<2){setMessage('Enter a valid store name.','err');return}if(password.length<10){setMessage('Password must be at least 10 characters.','err');return}persistRememberChoice(false);btn.disabled=true;setMessage('Creating seller account…');try{const first=$('firstName').value.trim(),last=$('lastName').value.trim(),sellerType=$('sellerType').value;const{data,error}=await client.auth.signUp({email:$('registerEmail').value.trim().toLowerCase(),password,options:{data:{full_name:[first,last].filter(Boolean).join(' '),store_name:storeName,seller_type:sellerType,phone:mobile,seller_registration_intent:true},emailRedirectTo:location.origin+'/login.html'}});if(error)throw error;if(data.session?.user){const{data:profileData,error:profileError}=await client.rpc('register_seller_profile',{p_store_name:storeName,p_seller_type:sellerType,p_phone:mobile});if(profileError)throw profileError;const profile=Array.isArray(profileData)?profileData[0]:profileData;if(!profile)throw new Error('Seller profile could not be created.');setUiSession(data.session.user,profile,false);location.href='index.html'}else{setMode('login');setMessage('Seller account created. Verify your email, then sign in.','ok')}}catch(error){setMessage(error.message||'Seller registration failed.','err')}finally{btn.disabled=false}});
 $('resetPasswordForm').addEventListener('submit',async event=>{event.preventDefault();const password=$('newPassword').value,confirm=$('confirmPassword').value,btn=$('resetPasswordSubmit');if(password.length<10){setMessage('Password must be at least 10 characters.','err');return}if(password!==confirm){setMessage('Passwords do not match.','err');return}btn.disabled=true;setMessage('Updating password…');try{const{error}=await client.auth.updateUser({password});if(error)throw error;await client.auth.signOut();history.replaceState({},'',location.pathname);setMode('login');setMessage('Password updated. Sign in with your new password.','ok')}catch(error){setMessage(error.message||'Password could not be updated.','err')}finally{btn.disabled=false}});
 authBound=true;setServiceReady(true);
}
start().catch(error=>{console.error('[Seller Center] Authentication startup failed',error);setServiceReady(false);const box=$('authMessage');if(box){box.textContent='Seller services are temporarily unavailable. Check your connection and reload.';box.className='auth-message err'}});
})();

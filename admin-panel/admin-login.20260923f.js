'use strict';
const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.FF_API_ORIGIN='';

const form=document.getElementById('form');
const email=document.getElementById('email');
const password=document.getElementById('password');
const submit=document.getElementById('submit');
const forgot=document.getElementById('forgot');
const banner=document.getElementById('banner');
const passwordToggle=document.getElementById('passwordToggle');
const remember=document.getElementById('remember');
const csrfToken=document.getElementById('csrfToken');
const REMEMBER_KEY='ff_admin_remember';
const CSRF_KEY='ff_admin_csrf_v1';
let db=null;

function show(message,type='error'){
  if(!banner)return;
  const isError=type!=='success';
  banner.textContent=message;
  banner.className='banner show '+type;
  banner.setAttribute('role',isError?'alert':'status');
  banner.setAttribute('aria-live',isError?'assertive':'polite');
}
function setRememberMode(value){
  try{localStorage.setItem(REMEMBER_KEY,value?'true':'false');}catch{}
}
function shouldRemember(){
  try{return localStorage.getItem(REMEMBER_KEY)==='true';}catch{return false;}
}
const authStorage={
  getItem(key){try{return (shouldRemember()?localStorage:sessionStorage).getItem(key);}catch{return null;}},
  setItem(key,value){
    try{
      const primary=shouldRemember()?localStorage:sessionStorage;
      const secondary=shouldRemember()?sessionStorage:localStorage;
      primary.setItem(key,value);
      secondary.removeItem(key);
    }catch{}
  },
  removeItem(key){try{localStorage.removeItem(key);sessionStorage.removeItem(key);}catch{}}
};
function makeToken(){
  const bytes=new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function ensureCsrfToken(){
  if(!csrfToken)return '';
  let token='';
  try{token=sessionStorage.getItem(CSRF_KEY)||'';}catch{}
  if(!token){
    token=makeToken();
    try{sessionStorage.setItem(CSRF_KEY,token);}catch{}
  }
  csrfToken.value=token;
  return token;
}
function hasValidCsrfToken(){
  if(!csrfToken?.value)return false;
  try{return csrfToken.value===sessionStorage.getItem(CSRF_KEY);}catch{return false;}
}
function getClient(){
  if(db?.auth)return db;
  if(!window.supabase||typeof window.supabase.createClient!=='function')throw new Error('Admin authentication service is unavailable.');
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{storage:authStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  window.supabaseClient=db;
  window.ffAdminSupabaseReady=Promise.resolve(db);
  window.ffSupabaseReady=window.ffAdminSupabaseReady;
  return db;
}
async function isAdmin(user,client){
  if(!user?.id)return false;
  const{data,error}=await client.from('profiles').select('is_admin').eq('id',user.id).maybeSingle();
  if(error)throw error;
  return data?.is_admin===true;
}
async function redirectExisting(){
  const client=getClient();
  const{data:{session},error}=await client.auth.getSession();
  if(error||!session?.user)return;
  if(await isAdmin(session.user,client)){location.replace('/admin');return;}
  await client.auth.signOut();
  show('This account does not have administrator access.');
}
function setPasswordToggleState(reveal){
  const label=reveal?'Hide administrator password':'Show administrator password';
  password.type=reveal?'text':'password';
  passwordToggle.setAttribute('aria-pressed',String(reveal));
  passwordToggle.setAttribute('aria-label',label);
  passwordToggle.setAttribute('title',label);
  passwordToggle.innerHTML=reveal
    ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 3l18 18"></path><path d="M10.6 10.7a2.5 2.5 0 0 0 3.5 3.5"></path><path d="M9.9 5.2A11.7 11.7 0 0 1 12 5c6.5 0 10 7 10 7a16.5 16.5 0 0 1-3 3.8"></path><path d="M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4-.8"></path></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12"></path><circle cx="12" cy="12" r="2.5"></circle></svg>';
}
async function checkLoginRateLimit(mail){
  const response=await fetch('/api/admin-login-guard',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    body:JSON.stringify({email:mail})
  });
  let payload={};
  try{payload=await response.json();}catch{}
  if(response.status===429){
    const retry=Math.max(1,Number(payload.retry_after_seconds||response.headers.get('Retry-After')||60));
    throw new Error(`Too many sign-in attempts. Try again in ${retry} seconds.`);
  }
  if(!response.ok||payload.allowed!==true)throw new Error('Admin sign-in protection is temporarily unavailable.');
}

if(remember){
  remember.checked=false;
  remember.addEventListener('change',()=>setRememberMode(remember.checked));
  addEventListener('pageshow',()=>{remember.checked=false;});
}
ensureCsrfToken();
setPasswordToggleState(false);

passwordToggle?.addEventListener('click',()=>{
  const reveal=password.type==='password';
  setPasswordToggleState(reveal);
  password.focus({preventScroll:true});
});

form?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!hasValidCsrfToken()){
    ensureCsrfToken();
    show('The sign-in page security token expired. Please submit again.');
    return;
  }
  setRememberMode(Boolean(remember?.checked));
  const mail=email.value.trim();
  if(!mail||!password.value){show('Enter your administrator email and password.');return;}
  submit.disabled=true;
  submit.textContent='Checking access…';
  try{
    await checkLoginRateLimit(mail);
    const client=getClient();
    const{data,error}=await client.auth.signInWithPassword({email:mail,password:password.value});
    if(error)throw error;
    if(!data?.user)throw new Error('Sign in could not be completed.');
    if(!await isAdmin(data.user,client)){
      await client.auth.signOut();
      throw new Error('Administrator privileges are required.');
    }
    show('Administrator verified. Opening dashboard…','success');
    location.replace('/admin');
  }catch(error){
    show(error?.message||'Unable to sign in.');
  }finally{
    submit.disabled=false;
    submit.textContent='Sign in to Admin';
  }
});

forgot?.addEventListener('click',async event=>{
  event.preventDefault();
  const mail=email.value.trim();
  if(!mail){
    show('Enter your administrator email address first.');
    email.focus({preventScroll:true});
    return;
  }
  forgot.setAttribute('aria-disabled','true');
  try{
    const client=getClient();
    const redirectTo=new URL('/reset-password',location.origin).href;
    const{error}=await client.auth.resetPasswordForEmail(mail,{redirectTo});
    if(error)throw error;
    show('Password reset email sent. Check your inbox.','success');
  }catch(error){
    show(error?.message||'Unable to send reset email.');
  }finally{
    forgot.removeAttribute('aria-disabled');
  }
});

function observeWebVitals(){
  if(!('PerformanceObserver' in window))return;
  let cls=0;
  window.ffAdminWebVitals={cls:0};
  try{
    const observer=new PerformanceObserver(list=>{
      for(const entry of list.getEntries()){
        if(!entry.hadRecentInput){cls+=entry.value;window.ffAdminWebVitals.cls=cls;}
      }
    });
    observer.observe({type:'layout-shift',buffered:true});
  }catch{}
}
observeWebVitals();

try{
  getClient();
  redirectExisting().catch(error=>{console.error(error);show('Unable to verify the current administrator session.');});
}catch(error){
  console.error(error);
  show('Admin authentication service is temporarily unavailable.');
}

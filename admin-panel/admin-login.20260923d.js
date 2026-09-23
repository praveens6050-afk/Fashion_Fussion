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
let db=null;

function show(message,type='error'){
  if(!banner)return;
  banner.textContent=message;
  banner.className='banner show '+type;
}
function getClient(){
  if(db?.auth)return db;
  if(!window.supabase||typeof window.supabase.createClient!=='function')throw new Error('Admin authentication service is unavailable.');
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
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

passwordToggle?.addEventListener('click',()=>{
  const reveal=password.type==='password';
  password.type=reveal?'text':'password';
  passwordToggle.setAttribute('aria-pressed',String(reveal));
  passwordToggle.setAttribute('aria-label',reveal?'Hide administrator password':'Show administrator password');
  password.focus({preventScroll:true});
});

form?.addEventListener('submit',async event=>{
  event.preventDefault();
  const mail=email.value.trim();
  if(!mail||!password.value){show('Enter your administrator email and password.');return;}
  submit.disabled=true;
  submit.textContent='Checking access…';
  try{
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

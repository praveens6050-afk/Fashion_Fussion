'use strict';
(function(){
 const form=document.getElementById('supportLogin'),email=document.getElementById('email'),password=document.getElementById('password'),submit=document.getElementById('submit'),status=document.getElementById('status');
 const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
 async function db(){const client=await ready;if(!client?.auth)throw new Error('Authentication service is unavailable.');return client}
 form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;status.textContent='Checking account…';try{const client=await db();const{data,error}=await client.auth.signInWithPassword({email:email.value.trim(),password:password.value});if(error)throw error;if(!data?.user)throw new Error('Sign in failed.');location.replace('support-inbox.html')}catch(err){status.textContent=err.message||'Unable to sign in.'}finally{submit.disabled=false}});
 (async()=>{try{const client=await db();const{data:{session}}=await client.auth.getSession();if(session?.user)location.replace('support-inbox.html')}catch{}})();
})();
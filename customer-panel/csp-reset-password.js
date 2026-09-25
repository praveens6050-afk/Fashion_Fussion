'use strict';

(async()=>{
  const resetSection=document.getElementById('resetSection');
  const invalidSection=document.getElementById('invalidSection');
  const form=document.getElementById('resetForm');
  const button=document.getElementById('resetButton');
  const message=document.getElementById('message');
  const params=new URLSearchParams(location.search);
  const recoveryHint=params.has('code')||params.get('type')==='recovery'||location.hash.includes('type=recovery');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let ready=false;

  function showReset(){resetSection.hidden=false;invalidSection.hidden=true}
  function showInvalid(){resetSection.hidden=true;invalidSection.hidden=false}
  function show(msg,type){message.textContent=msg;message.className='message '+type}

  let client;
  try{
    client=window.supabaseClient||await window.ffSupabaseReady;
  }catch(error){
    console.error('Password recovery client initialization failed',error);
    showInvalid();
    return;
  }
  if(!client?.auth){showInvalid();return}

  client.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      ready=true;
      showReset();
      return;
    }
    if(event==='SIGNED_IN'&&session&&recoveryHint){
      ready=true;
      showReset();
    }
  });

  async function waitForRecoverySession(){
    if(!recoveryHint){
      showInvalid();
      return;
    }
    for(let attempt=0;attempt<20&&!ready;attempt++){
      try{
        const{data,error}=await client.auth.getSession();
        if(error)throw error;
        if(data?.session){
          ready=true;
          showReset();
          return;
        }
      }catch(error){
        console.error('Password recovery session check failed',error);
      }
      await sleep(500);
    }
    if(!ready)showInvalid();
  }

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!ready){show('Recovery session is not valid. Request a new reset link.','error');return}
    const password=document.getElementById('password').value;
    const confirm=document.getElementById('confirmPassword').value;
    if(password.length<10){show('Password must be at least 10 characters.','error');return}
    if(password!==confirm){show('Passwords do not match.','error');return}
    button.disabled=true;
    button.textContent='Updating…';
    try{
      const{error}=await client.auth.updateUser({password});
      if(error)throw error;
      show('Password updated successfully. Redirecting to login…','success');
      form.reset();
      setTimeout(async()=>{
        try{await client.auth.signOut()}catch(error){console.error('Password recovery sign-out failed',error)}
        location.replace('login.html');
      },1200);
    }catch(error){
      show(error.message||'Unable to update password.','error');
      button.disabled=false;
      button.textContent='Update Password';
    }
  });

  await waitForRecoverySession();
})().catch(error=>{
  console.error('Password recovery failed',error);
  const resetSection=document.getElementById('resetSection');
  const invalidSection=document.getElementById('invalidSection');
  if(resetSection)resetSection.hidden=true;
  if(invalidSection)invalidSection.hidden=false;
});
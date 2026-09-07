(function(){
  'use strict';
  if(location.pathname.split('/').pop()!=='account.html'||!window.supabaseClient)return;
  const supa=window.supabaseClient;
  const norm=v=>{let p=String(v||'').trim().replace(/[\s()-]/g,'');if(/^0\d{10}$/.test(p))p='+91'+p.slice(1);if(/^\d{10}$/.test(p))p='+91'+p;return p};
  function add(){
    const phone=document.getElementById('phone'); if(!phone||document.getElementById('ffPhoneVerify'))return;
    const box=document.createElement('div'); box.id='ffPhoneVerify'; box.className='ff-otp';
    box.innerHTML='<div style="font-weight:700;margin-bottom:6px">Mobile verification</div><div id="ffPhoneStatus" style="font-size:12px;color:#666;margin-bottom:8px"></div><button id="ffVerifyPhone" type="button">Verify mobile with OTP</button><div id="ffPhoneOtp" style="display:none;margin-top:10px"><input id="ffPhoneCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit OTP"><button id="ffConfirmPhone" type="button">Confirm OTP</button></div>';
    phone.closest('.form-group')?.appendChild(box);
    const status=box.querySelector('#ffPhoneStatus');
    async function refresh(){const{data:{user}}=await supa.auth.getUser();if(!user)return;status.textContent=user.phone&&user.phone_confirmed_at?'✓ Mobile number is verified.':'Mobile number is not verified.';}
    box.querySelector('#ffVerifyPhone').onclick=async()=>{const p=norm(phone.value);if(!/^\+\d{8,15}$/.test(p)){status.textContent='Enter a valid mobile number first.';return}try{const{data:{user}}=await supa.auth.getUser();if(!user)return;if(user.phone!==p){const{error}=await supa.auth.updateUser({phone:p});if(error)throw error}const{error}=await supa.auth.signInWithOtp({phone:p});if(error)throw error;box.querySelector('#ffPhoneOtp').style.display='block';status.textContent='OTP sent. Enter the code to verify this mobile number.'}catch(e){status.textContent=e.message||'Could not send OTP.'}};
    box.querySelector('#ffConfirmPhone').onclick=async()=>{const p=norm(phone.value),token=box.querySelector('#ffPhoneCode').value.trim();if(!/^\d{6}$/.test(token)){status.textContent='Enter the 6-digit OTP.';return}try{const{error}=await supa.auth.verifyOtp({phone:p,token,type:'sms'});if(error)throw error;status.textContent='✓ Mobile number verified successfully.';box.querySelector('#ffPhoneOtp').style.display='none'}catch(e){status.textContent=e.message||'Invalid or expired OTP.'}};
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add();
})();

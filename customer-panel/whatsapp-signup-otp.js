'use strict';
(()=>{
  const API='https://seller.fashionfussion.in/api/whatsapp-otp';
  const form=document.getElementById('signupForm'),phone=document.getElementById('phone'),email=document.getElementById('email');
  const send=document.getElementById('sendWhatsappOtp'),verify=document.getElementById('verifyWhatsappOtp'),otp=document.getElementById('whatsappOtp'),status=document.getElementById('whatsappOtpStatus');
  if(!form||!phone||!email||!send||!verify||!otp||!status)return;
  let challengeId='',verifiedKey='',timer=null,remaining=0;
  function accountType(){return document.querySelector('input[name="accountType"]:checked')?.value==='retailer'?'retailer':'customer'}
  function key(){return `${email.value.trim().toLowerCase()}|${phone.value.replace(/\D/g,'')}|${accountType()}`}
  function setStatus(text,type=''){status.textContent=text;status.className='hint whatsapp-otp-status '+type}
  function reset(){challengeId='';verifiedKey='';otp.value='';verify.disabled=true;send.disabled=false;if(timer)clearInterval(timer);timer=null;remaining=0;send.textContent='Send OTP on WhatsApp';setStatus('Verify this mobile number before creating your account.')}
  function startTimer(seconds){remaining=seconds;send.disabled=true;send.textContent=`Resend in ${remaining}s`;if(timer)clearInterval(timer);timer=setInterval(()=>{remaining-=1;if(remaining<=0){clearInterval(timer);timer=null;send.disabled=false;send.textContent='Resend OTP'}else send.textContent=`Resend in ${remaining}s`},1000)}
  async function call(body){const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'WhatsApp OTP request failed');return d}
  send.addEventListener('click',async()=>{const mail=email.value.trim().toLowerCase(),mobile=phone.value.trim();if(!mail){setStatus('Enter your email address first.','error');email.focus();return}if(!/^\+?[0-9\s()-]{10,20}$/.test(mobile)){setStatus('Enter a valid mobile number first.','error');phone.focus();return}send.disabled=true;setStatus('Sending verification code on WhatsApp…');try{const d=await call({action:'send',email:mail,phone:mobile,audience:accountType()});challengeId=d.challenge_id;verifiedKey='';verify.disabled=false;startTimer(d.resend_after||60);setStatus(`OTP sent to ${d.phone_hint||'your WhatsApp number'}. It expires in 5 minutes.`,'success');otp.focus()}catch(e){send.disabled=false;send.textContent='Send OTP on WhatsApp';setStatus(e.message,'error')}});
  verify.addEventListener('click',async()=>{if(!challengeId){setStatus('Send an OTP first.','error');return}const code=otp.value.replace(/\D/g,'');if(code.length!==6){setStatus('Enter the 6-digit OTP.','error');otp.focus();return}verify.disabled=true;setStatus('Verifying OTP…');try{await call({action:'verify',challenge_id:challengeId,otp:code});verifiedKey=key();setStatus('Mobile number verified on WhatsApp.','success');send.disabled=true;send.textContent='Verified';otp.disabled=true}catch(e){verify.disabled=false;setStatus(e.message,'error')}});
  [phone,email].forEach(el=>el.addEventListener('input',()=>{if(verifiedKey&&verifiedKey!==key()){otp.disabled=false;reset()}}));
  document.querySelectorAll('input[name="accountType"]').forEach(el=>el.addEventListener('change',()=>{if(verifiedKey&&verifiedKey!==key()){otp.disabled=false;reset()}}));
  form.addEventListener('submit',e=>{if(verifiedKey!==key()){e.preventDefault();e.stopImmediatePropagation();setStatus('Verify your mobile number on WhatsApp before creating the account.','error');send.focus()}},true);
  window.ffWhatsappOtp={isVerified:()=>verifiedKey===key(),reset};
  reset();
})();

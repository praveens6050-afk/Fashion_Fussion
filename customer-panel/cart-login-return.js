(function(){
'use strict';
const CART_RETURN='cart.html';
const loginHref='login.html?redirect='+encodeURIComponent(CART_RETURN);

async function signedIn(){
  try{
    const {data:{session}}=await window.supabaseClient.auth.getSession();
    return Boolean(session?.user);
  }catch{return false;}
}

function rewriteSignedOutCartCopy(){
  const address=document.getElementById('address');
  if(!address)return;
  address.querySelectorAll('a[href*="login.html"]').forEach(link=>{
    link.href=loginHref;
    link.textContent='Sign in';
  });
  const muted=address.querySelector('.muted');
  if(muted&&/sign in|checkout/i.test(muted.textContent||'')){
    muted.textContent='After sign in, you’ll return to this cart before checkout.';
  }
}

function installCheckoutGuard(){
  const button=document.getElementById('place');
  if(!button||button.dataset.loginReturnGuard==='true')return false;
  button.dataset.loginReturnGuard='true';
  button.onclick=async event=>{
    event?.preventDefault?.();
    if(button.disabled)return;
    button.disabled=true;
    try{
      if(await signedIn()) location.href='checkout.html';
      else location.href=loginHref;
    }finally{
      setTimeout(()=>{if(document.visibilityState==='visible')button.disabled=false;},1200);
    }
  };
  return true;
}

function install(){
  installCheckoutGuard();
  rewriteSignedOutCartCopy();
  const address=document.getElementById('address');
  if(address&&!address.__ffLoginReturnObserver){
    const observer=new MutationObserver(rewriteSignedOutCartCopy);
    observer.observe(address,{childList:true,subtree:true});
    address.__ffLoginReturnObserver=observer;
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
setTimeout(install,300);
setTimeout(install,1200);
})();

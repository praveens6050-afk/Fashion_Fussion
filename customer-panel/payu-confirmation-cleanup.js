(function(){
'use strict';
const CART_KEY='fashion_fussion_cart';
const CHECKOUT_KEY='fashion_fussion_checkout_key';
const PAYU_PENDING_KEY='fashion_fussion_payu_pending_order';

async function run(){
  const orderId=new URLSearchParams(location.search).get('id');
  const pending=sessionStorage.getItem(PAYU_PENDING_KEY);
  if(!/^\d+$/.test(String(orderId||''))||String(pending||'')!==String(orderId))return;
  if(!window.supabaseClient)return;
  try{
    const {data:{user}}=await window.supabaseClient.auth.getUser();
    if(!user)return;
    const {data,error}=await window.supabaseClient
      .from('orders')
      .select('id,status,payment_provider')
      .eq('id',Number(orderId))
      .eq('user_id',user.id)
      .maybeSingle();
    if(error||!data)return;
    if(String(data.status||'').toLowerCase()!=='paid'||String(data.payment_provider||'').toLowerCase()!=='payu')return;
    localStorage.removeItem(CART_KEY);
    sessionStorage.removeItem(CHECKOUT_KEY);
    sessionStorage.removeItem(PAYU_PENDING_KEY);
  }catch(error){
    console.warn('PayU checkout cleanup will retry on the next confirmation visit.');
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();

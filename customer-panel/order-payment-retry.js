(function(){
'use strict';
const BACKEND_URL=window.FF_API_ORIGIN||'';
const ACTIVE=new Set(['creating','created','pending','payment_pending']);
const RESTART=new Set(['payment_failed','failed','expired']);
const safe=(e,fallback='We could not complete this action. Please try again.')=>window.ffCustomerMessage?window.ffCustomerMessage(e,fallback):fallback;
let order=null,session=null,busy=false;

function orderId(){
  const p=new URLSearchParams(location.search),v=p.get('id')||p.get('order');
  return /^\d+$/.test(String(v||''))?Number(v):null;
}

async function api(path,body){
  if(!session?.access_token)throw new Error('Your session has expired. Please sign in again.');
  const response=await fetch(BACKEND_URL+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data.error||'Request failed');e.data=data;throw e;}
  return data;
}

function ensureStyles(){
  if(document.getElementById('ffPaymentRetryStyles'))return;
  const style=document.createElement('style');style.id='ffPaymentRetryStyles';style.textContent='.ff-payment-retry{margin:0 0 24px;border:1px solid #e4e7ec;border-radius:16px;background:#fff;overflow:hidden}.ff-payment-retry-head{padding:18px 20px;border-bottom:1px solid #eaecf0;display:flex;justify-content:space-between;gap:12px;align-items:center}.ff-payment-retry-head h2{margin:0;font-size:18px}.ff-payment-retry-body{padding:20px}.ff-payment-retry-body p{margin:0 0 14px;color:#667085;line-height:1.55}.ff-payment-retry-actions{display:flex;gap:10px;flex-wrap:wrap}.ff-payment-retry-btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border:0;border-radius:10px;padding:12px 18px;font-weight:800;cursor:pointer;background:#5b35e5;color:#fff}.ff-payment-retry-btn.secondary{background:#fff;color:#344054;border:1px solid #d0d5dd}.ff-payment-retry-btn:disabled{opacity:.55;cursor:not-allowed}.ff-payment-retry-status{margin-top:12px;padding:10px 12px;border-radius:9px;background:#f8fafc;color:#475467;font-size:13px;display:none}.ff-payment-retry-status.show{display:block}.ff-payment-retry-status.good{background:#ecfdf3;color:#067647}.ff-payment-retry-status.bad{background:#fff1f0;color:#b42318}@media(max-width:640px){.ff-payment-retry-actions{display:grid}.ff-payment-retry-btn{width:100%;box-sizing:border-box}}';document.head.appendChild(style);
}

function message(text,type='info'){
  const el=document.getElementById('ffPaymentRetryStatus');if(!el)return;
  el.textContent=text||'';el.className='ff-payment-retry-status'+(text?' show '+type:'');
}

function target(){return document.querySelector('#root .layout');}

function render(){
  if(!order||document.getElementById('ffPaymentRetry'))return;
  const status=String(order.status||'').toLowerCase();
  if(String(order.payment_method||'').toLowerCase()!=='prepaid'||order.payment_verified_at||status==='paid')return;
  if(!ACTIVE.has(status)&&!RESTART.has(status))return;
  const t=target();if(!t)return;
  ensureStyles();
  const box=document.createElement('section');box.id='ffPaymentRetry';box.className='ff-payment-retry';
  const active=ACTIVE.has(status);
  box.innerHTML='<div class="ff-payment-retry-head"><h2>'+(active?'Complete online payment':'Payment needs a new checkout')+'</h2><strong>'+(active?'Payment pending':'Payment not completed')+'</strong></div><div class="ff-payment-retry-body"><p>'+(active?'Your order is waiting for payment. You can safely continue payment from this same order. The order is confirmed only after payment verification.':'This payment session is no longer active. Return to your cart to start a fresh checkout.')+'</p><div class="ff-payment-retry-actions">'+(active?'<button id="ffResumePayment" class="ff-payment-retry-btn" type="button">Complete payment</button>':'<a class="ff-payment-retry-btn" href="cart.html">Return to cart</a>')+'<a class="ff-payment-retry-btn secondary" href="account.html#orders">My Orders</a></div><div id="ffPaymentRetryStatus" class="ff-payment-retry-status" aria-live="polite"></div></div>';
  t.parentNode.insertBefore(box,t);
  if(active)document.getElementById('ffResumePayment').addEventListener('click',resume);
  if(location.hash==='#payment')setTimeout(()=>box.scrollIntoView({behavior:'smooth',block:'center'}),100);
}

function loadRazorpay(){
  if(window.Razorpay)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-ff-razorpay-checkout]');
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('Online payment could not be loaded.')),{once:true});return;}
    const s=document.createElement('script');s.src='https://checkout.razorpay.com/v1/checkout.js';s.async=true;s.dataset.ffRazorpayCheckout='true';s.onload=resolve;s.onerror=()=>reject(new Error('Online payment could not be loaded.'));document.head.appendChild(s);
  });
}

async function reconcile(){
  try{
    const d=await api('/api/reconcile-payment',{store_order_id:order.id});
    if(d?.reconciled&&d.status==='paid'){location.href='order-confirmation.html?id='+encodeURIComponent(d.store_order_id||order.id);return true;}
    if(d?.captured){message(d.message||'Payment has been received and is being confirmed. Please do not pay again.','good');return true;}
  }catch(e){
    if(e.data?.captured){message(e.data.message||'Payment has been received and needs confirmation. Please do not pay again.','good');return true;}
    console.warn('payment status check unavailable');
  }
  return false;
}

async function confirmPayment(details,resumeData){
  message('Payment received. Confirming your order…','good');
  try{
    const verified=await api('/api/verify-payment',{order_id:resumeData.order.id,razorpay_payment_id:details.razorpay_payment_id,razorpay_order_id:details.razorpay_order_id,razorpay_signature:details.razorpay_signature});
    if(verified?.verified){location.href='order-confirmation.html?id='+encodeURIComponent(verified.store_order_id||order.id);return;}
  }catch(e){
    if(e.data?.captured||e.data?.recoverable){
      if(await reconcile())return;
      message('Payment was received and is still being confirmed. Please do not pay again. Check My Orders shortly.','good');
      return;
    }
    message(safe(e,'Payment could not be confirmed. Check My Orders before trying again.'),'bad');
    return;
  }
  if(!(await reconcile()))message('Payment confirmation is still pending. Please do not pay again yet. Check My Orders shortly.','good');
}

function replaceWithCartAction(){
  const btn=document.getElementById('ffResumePayment');if(!btn)return;
  const link=document.createElement('a');link.className='ff-payment-retry-btn';link.href='cart.html';link.textContent='Return to cart';btn.replaceWith(link);
}

async function resume(){
  if(busy||!order)return;busy=true;
  const btn=document.getElementById('ffResumePayment');if(btn){btn.disabled=true;btn.textContent='Checking payment…';}
  message('Checking the latest payment status…');
  try{
    if(await reconcile())return;
    const d=await api('/api/resume-payment',{store_order_id:order.id});
    if(d.completed&&d.status==='paid'){location.href='order-confirmation.html?id='+encodeURIComponent(d.store_order_id||order.id);return;}
    if(d.captured){message(d.message||'Payment has been received and is being confirmed. Please do not pay again.','good');await reconcile();return;}
    if(!d.order?.id||!d.key_id)throw new Error('Online payment could not be prepared. Please try again.');
    await loadRazorpay();
    if(btn)btn.textContent='Complete payment';
    const rz=new Razorpay({key:d.key_id,amount:d.order.amount,currency:d.order.currency||'INR',name:'Fashion Fussion',description:'Complete order payment',order_id:d.order.id,prefill:{name:d.customer?.name||order.customer_name||'',email:d.customer?.email||session.user.email||'',contact:d.customer?.phone||order.customer_phone||''},handler:payment=>confirmPayment(payment,d),modal:{ondismiss:()=>message('Payment window closed. You can continue this payment later from the same order.')}});
    rz.on('payment.failed',()=>message('Payment was not completed. You can safely try again from this same order.','bad'));
    rz.open();
  }catch(e){
    if(e.data?.restart_checkout){message('This payment session is no longer active. Return to your cart to start a new checkout.','bad');replaceWithCartAction();}
    else message(safe(e,'Unable to continue payment. Please try again.'),'bad');
  }finally{
    busy=false;const current=document.getElementById('ffResumePayment');if(current){current.disabled=false;if(current.textContent==='Checking payment…')current.textContent='Complete payment';}
  }
}

async function init(){
  const id=orderId();if(!id||!window.supabaseClient)return;
  const {data:{session:s}}=await supabaseClient.auth.getSession();session=s;if(!session?.user)return;
  const {data,error}=await supabaseClient.from('orders').select('id,display_order_id,status,payment_method,payment_verified_at,total_amount,currency,razorpay_order_id,customer_name,customer_email,customer_phone').eq('id',id).eq('user_id',session.user.id).maybeSingle();
  if(error||!data)return;order=data;
  let tries=0;const timer=setInterval(()=>{tries++;if(target()){clearInterval(timer);render();}else if(tries>80)clearInterval(timer);},100);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

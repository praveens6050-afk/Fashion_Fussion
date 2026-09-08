(function(){
'use strict';
if(!window.supabaseClient)return;
if((location.pathname.split('/').pop()||'index.html')!=='index.html')return;
const supa=window.supabaseClient;
const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let defaultAddress=null,loading=false,allowCheckout=false;
function card(){return document.getElementById('ffCheckoutAddress')}
function install(){
 const btn=document.getElementById('checkoutBtn');if(!btn)return setTimeout(install,200);if(card())return;
 const style=document.createElement('style');style.textContent=`
 #ffCheckoutAddress{margin:14px 0 16px;padding:0;border:1px solid #d8cdae;border-radius:8px;background:#fffdf8;font-size:13px;line-height:1.45;overflow:hidden;color:#1c2333}
 .ff-address-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #eee4d2;background:#faf6ec}
 .ff-address-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#1b2a4a}
 .ff-address-change{color:#1b5fd1;font-weight:700;text-decoration:none;white-space:nowrap;padding:4px 0}
 .ff-address-body{padding:12px 14px}
 .ff-address-person{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px}
 .ff-address-name{font-weight:700;text-transform:none;color:#1c2333}
 .ff-address-phone{color:#4b5266}
 .ff-address-lines{color:#394154;line-height:1.55;word-break:break-word}
 .ff-address-empty{padding:12px 14px;color:#4b5266}
 .ff-address-empty.error{color:#a22f27}
 .ff-address-add{display:inline-block;margin-top:8px;color:#1b5fd1;font-weight:700;text-decoration:none}
 @media(max-width:480px){#ffCheckoutAddress{font-size:12.5px}.ff-address-head,.ff-address-body,.ff-address-empty{padding:11px 12px}}
 `;document.head.appendChild(style);
 const box=document.createElement('div');box.id='ffCheckoutAddress';btn.parentNode.insertBefore(box,btn);btn.addEventListener('click',guard,true);refresh();document.addEventListener('click',e=>{if(e.target.closest('#cartBtn,#cartButton,[data-cart],.cart-button'))setTimeout(refresh,150)});supa.auth.onAuthStateChange(()=>setTimeout(refresh,50));
}
async function refresh(){
 const box=card();if(!box||loading)return;loading=true;
 box.innerHTML='<div class="ff-address-head"><div class="ff-address-title">📍 Delivery Address</div></div><div class="ff-address-empty">Checking saved address...</div>';
 try{
  const{data:{user}}=await supa.auth.getUser();
  if(!user){defaultAddress=null;box.innerHTML='<div class="ff-address-head"><div class="ff-address-title">📍 Delivery Address</div></div><div class="ff-address-empty">Login to use your saved delivery address.</div>';return}
  const{data,error}=await supa.from('customer_addresses').select('id,label,full_name,phone,address_line1,address_line2,city,state,postal_code,country,is_default').eq('user_id',user.id).eq('is_default',true).limit(1).maybeSingle();if(error)throw error;defaultAddress=data||null;
  if(!data){box.innerHTML='<div class="ff-address-head"><div class="ff-address-title">📍 Delivery Address</div><a class="ff-address-change" href="account.html">Add</a></div><div class="ff-address-empty error">No default delivery address selected.<br><a class="ff-address-add" href="account.html">+ Add / Select Address</a></div>';return}
  const line2=data.address_line2?'<br>'+esc(data.address_line2):'';
  box.innerHTML='<div class="ff-address-head"><div class="ff-address-title">📍 Deliver to '+esc(data.label||'Address')+'</div><a class="ff-address-change" href="account.html">Change</a></div><div class="ff-address-body"><div class="ff-address-person"><span class="ff-address-name">'+esc(data.full_name)+'</span><span class="ff-address-phone">'+esc(data.phone)+'</span></div><div class="ff-address-lines">'+esc(data.address_line1)+line2+'<br>'+esc(data.city)+', '+esc(data.state)+' '+esc(data.postal_code)+'</div></div>';
 }catch(err){console.error('Address load error:',err);defaultAddress=null;box.innerHTML='<div class="ff-address-head"><div class="ff-address-title">📍 Delivery Address</div></div><div class="ff-address-empty error">Unable to load saved address.</div>'}finally{loading=false}
}
async function guard(e){if(allowCheckout){allowCheckout=false;return}e.preventDefault();e.stopImmediatePropagation();const btn=document.getElementById('checkoutBtn');const old=btn.textContent;btn.disabled=true;btn.textContent='Checking address…';await refresh();btn.disabled=false;btn.textContent=old;if(!defaultAddress){alert('Please add and select a default delivery address before checkout.');location.href='account.html';return}if(typeof window.checkout!=='function'){alert('Checkout is still loading. Please try again.');return}allowCheckout=true;window.checkout()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
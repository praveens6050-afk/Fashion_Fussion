/* Fashion_Fussion customer-facing enhancements */
(function(){
  const FREE_DELIVERY_THRESHOLD = 299;
  const DELIVERY_FEE = 49;
  function money(n){ return '₹' + Number(n||0).toLocaleString('en-IN'); }
  function updateDeliveryMessaging(){
    document.querySelectorAll('*').forEach(el=>{
      if(el.children.length) return;
      if(!el.textContent) return;
      el.textContent = el.textContent.replaceAll('Free delivery above ₹599','Free delivery above ₹299').replaceAll('free delivery above ₹599','free delivery above ₹299').replaceAll('above ₹599','above ₹299');
    });
    const subtotalEl=document.getElementById('cartSubtotal');
    const deliveryEl=document.getElementById('cartDelivery');
    const totalEl=document.getElementById('cartTotal');
    if(!subtotalEl || !deliveryEl || !totalEl) return;
    const subtotal=Number(String(subtotalEl.textContent).replace(/[^0-9.]/g,''))||0;
    const oldDelivery=deliveryEl.textContent.trim()==='FREE' ? 0 : Number(String(deliveryEl.textContent).replace(/[^0-9.]/g,''))||0;
    const newDelivery=subtotal<=0 ? 0 : subtotal>=FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
    const total=Number(String(totalEl.textContent).replace(/[^0-9.]/g,''))||0;
    const correctedTotal=total-oldDelivery+newDelivery;
    deliveryEl.textContent=newDelivery ? money(newDelivery) : 'FREE';
    totalEl.textContent=money(correctedTotal);
    const note=document.getElementById('cartPricingNote');
    if(note) note.textContent = subtotal>=FREE_DELIVERY_THRESHOLD ? 'Free delivery on orders of ₹299 or more.' : 'Delivery charge ₹49 below ₹299. Final pricing is confirmed securely by the server.';
  }
  function injectChat(){
    if(document.getElementById('ffChatButton')) return;
    const style=document.createElement('style');
    style.textContent=`#ffChatButton{position:fixed;right:20px;bottom:20px;z-index:9999;border:0;border-radius:999px;padding:13px 18px;background:#1B2A4A;color:#fff;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer}#ffChatBox{position:fixed;right:20px;bottom:76px;width:min(360px,calc(100vw - 30px));z-index:9999;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 16px 45px rgba(0,0,0,.22);display:none;overflow:hidden}#ffChatHead{background:#1B2A4A;color:#fff;padding:13px 15px;font-weight:700;display:flex;justify-content:space-between}#ffChatBody{padding:14px;max-height:320px;overflow:auto;font-size:14px;line-height:1.5}#ffChatInput{display:flex;border-top:1px solid #eee}#ffChatInput input{flex:1;border:0;padding:12px;outline:0}#ffChatInput button{border:0;background:#E5972E;color:#1B2A4A;padding:0 15px;font-weight:700}.ff-msg{margin:7px 0;padding:9px 11px;border-radius:9px;background:#f4f4f4}.ff-user{background:#eef2ff;text-align:right}`;
    document.head.appendChild(style);
    const btn=document.createElement('button'); btn.id='ffChatButton'; btn.type='button'; btn.textContent='💬 Customer Care';
    const box=document.createElement('div'); box.id='ffChatBox';
    box.innerHTML=`<div id="ffChatHead"><span>Fashion_Fussion Customer Care</span><button id="ffChatClose" style="border:0;background:none;color:#fff;font-size:18px">×</button></div><div id="ffChatBody"><div class="ff-msg">Hi! How can we help? Ask about delivery, orders, returns, payment or account.</div></div><div id="ffChatInput"><input id="ffChatText" placeholder="Type your question…" maxlength="300"><button id="ffChatSend">Send</button></div>`;
    document.body.append(btn,box);
    const body=box.querySelector('#ffChatBody'); const input=box.querySelector('#ffChatText');
    function answer(q){
      q=q.toLowerCase();
      if(q.includes('delivery')||q.includes('shipping')) return 'Delivery is ₹49 for orders below ₹299. Orders of ₹299 or more get free delivery.';
      if(q.includes('return')) return 'For a product issue, contact Fashion_Fussion support within 48 hours of delivery with order details and photos.';
      if(q.includes('payment')||q.includes('razorpay')) return 'Payments are processed through Razorpay. Card, UPI and other available methods are handled in Razorpay Checkout.';
      if(q.includes('order')) return 'After login, open My Account to view your orders and saved delivery addresses.';
      if(q.includes('address')) return 'Open My Account → Delivery Addresses to add, edit, delete or change your default address.';
      if(q.includes('login')||q.includes('otp')) return 'You can sign in with email/password or with a verified mobile number using SMS OTP.';
      return 'I can help with delivery, orders, returns, payments, login/OTP and delivery addresses. Please tell me what you need.';
    }
    function send(){const q=input.value.trim(); if(!q)return; const safe=q.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); body.insertAdjacentHTML('beforeend',`<div class="ff-msg ff-user">${safe}</div><div class="ff-msg">${answer(q)}</div>`); input.value=''; body.scrollTop=body.scrollHeight;}
    btn.onclick=()=>{box.style.display=box.style.display==='block'?'none':'block';}; box.querySelector('#ffChatClose').onclick=()=>box.style.display='none'; box.querySelector('#ffChatSend').onclick=send; input.onkeydown=e=>{if(e.key==='Enter')send();};
  }
  function start(){ injectChat(); updateDeliveryMessaging(); const observer=new MutationObserver(()=>updateDeliveryMessaging()); observer.observe(document.body,{subtree:true,childList:true,characterData:true}); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();

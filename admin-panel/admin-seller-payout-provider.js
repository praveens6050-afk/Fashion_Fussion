'use strict';
(()=>{
  if(window.__ffAdminSellerPayoutProvider)return;window.__ffAdminSellerPayoutProvider=true;
  const client=window.supabaseClient;if(!client)return;
  let configured=false;
  async function session(){const{data:{session},error}=await client.auth.getSession();if(error||!session?.access_token)throw new Error('Admin session expired');return session}
  async function readiness(){try{const r=await fetch('/api/seller-payout',{headers:{'Cache-Control':'no-store'}});const d=await r.json().catch(()=>({}));configured=Boolean(r.ok&&d.configured);return d}catch{return{configured:false}}}
  async function send(id,button){if(!configured){alert('Seller payout provider is not configured.');return}if(!confirm('Send this settlement to the payout provider? This can move real money when live provider credentials are configured.'))return;button.disabled=true;try{const s=await session();const r=await fetch('/api/seller-payout',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token},body:JSON.stringify({settlement_id:Number(id)})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Seller payout failed');alert(d.already_paid?'Settlement was already paid.':'Payout submitted. Provider status: '+(d.provider_status||'processing'));document.getElementById('refreshSellerFinance')?.click()}catch(e){alert(e.message||'Seller payout failed')}finally{button.disabled=false}}
  function enhance(){document.querySelectorAll('[data-settle-edit]').forEach(edit=>{const id=edit.dataset.settleEdit;if(!id||document.querySelector('[data-send-payout="'+CSS.escape(String(id))+'"]'))return;const btn=document.createElement('button');btn.type='button';btn.className='primary';btn.dataset.sendPayout=id;btn.textContent=configured?'Send payout':'Payout unavailable';btn.disabled=!configured;edit.insertAdjacentElement('afterend',btn)})}
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-send-payout]');if(b)send(b.dataset.sendPayout,b)});
  const observer=new MutationObserver(enhance);observer.observe(document.documentElement,{childList:true,subtree:true});
  readiness().then(()=>enhance());
})();

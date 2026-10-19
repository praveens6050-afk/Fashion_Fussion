'use strict';
(function(){
  const $=id=>document.getElementById(id), db=window.supabaseClient;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label={customer_support:'Customer Support',seller_support:'Seller Support',sales:'Sales',marketing:'Marketing',administrator:'All Departments'};
  let conversations=[],selected=null,loading=false;
  function notice(t){const n=$('crmInboxNotice');if(n)n.textContent=t}
  function fmt(v){return v?new Date(v).toLocaleString():'—'}
  function providerName(v){return v==='whatsapp'?'WhatsApp':'Email'}
  function renderList(){
    const term=($('crmInboxSearch')?.value||'').toLowerCase().trim(),channel=$('crmInboxChannel')?.value||'all',status=$('crmInboxStatus')?.value||'all';
    const rows=conversations.filter(c=>(channel==='all'||c.provider===channel)&&(status==='all'||c.status===status)&&(!term||[c.contact_name,c.contact_email,c.contact_phone,c.subject,c.latest_message,c.inbox_address].some(v=>String(v||'').toLowerCase().includes(term))));
    $('crmInboxRows').innerHTML=rows.length?rows.map(c=>'<button type="button" class="crm-inbox-item '+(selected===c.id?'selected':'')+'" data-thread="'+c.id+'"><span class="crm-inbox-top"><strong>'+esc(c.contact_name||c.contact_email||c.contact_phone||'Unknown contact')+'</strong><span class="crm-inbox-channel">'+esc(providerName(c.provider))+'</span></span><span class="crm-inbox-subject">'+esc(c.subject||'Incoming message')+'</span><span class="crm-inbox-preview">'+esc(c.latest_message)+'</span><span class="crm-inbox-meta">'+esc(label[c.department]||c.department)+' · '+esc(c.status)+' · '+esc(fmt(c.received_at))+'</span></button>').join(''):'<p class="crm-inbox-empty">No incoming messages match these filters.</p>';
    $('crmInboxRows').querySelectorAll('[data-thread]').forEach(b=>b.addEventListener('click',()=>openThread(Number(b.dataset.thread))));
    $('crmInboxCount').textContent=rows.length+' message thread(s)';
  }
  async function refresh(quiet=false){
    if(loading)return;loading=true;
    try{
      const{data,error}=await db.from('crm_inbox_conversations').select('id,provider,department,contact_type,contact_name,contact_email,contact_phone,inbox_address,subject,latest_message,received_at,status,priority,assigned_to').order('received_at',{ascending:false}).limit(300);
      if(error)throw error;conversations=data||[];renderList();
      if(selected&&!conversations.some(c=>c.id===selected)){selected=null;$('crmInboxThread').innerHTML='<p>Select a conversation to view messages.</p>'}
      if(!quiet)notice('Inbox refreshed at '+new Date().toLocaleTimeString()+'. Incoming messages only; replies are not enabled.');
      if(selected)await openThread(selected,true);
    }catch(e){notice('Inbox could not load. Verify migration, team role and provider webhook setup.');console.error('[CRM inbox]',e)}
    finally{loading=false}
  }
  async function openThread(id,quiet=false){
    selected=id;const c=conversations.find(x=>x.id===id);if(!c)return;
    renderList();$('crmInboxThread').innerHTML='<h3>'+esc(c.contact_name||c.contact_email||c.contact_phone||'Unknown contact')+'</h3><p>'+esc(label[c.department]||c.department)+' · '+esc(providerName(c.provider))+' · '+esc(c.status)+'</p><p><strong>'+esc(c.subject||'Incoming message')+'</strong></p><p>Loading message history…</p>';
    try{
      const{data,error}=await db.from('crm_inbox_messages').select('id,direction,sender_label,body,received_at').eq('conversation_id',id).order('received_at',{ascending:true}).limit(100);
      if(error)throw error;
      const messages=data||[];
      $('crmInboxThread').innerHTML='<div class="crm-inbox-thread-head"><div><h3>'+esc(c.contact_name||c.contact_email||c.contact_phone||'Unknown contact')+'</h3><p>'+esc(c.contact_email||'')+(c.contact_phone?' · '+esc(c.contact_phone):'')+'</p></div><span class="crm-inbox-channel">'+esc(providerName(c.provider))+'</span></div><p><strong>'+esc(c.subject||'Incoming message')+'</strong></p><div class="crm-inbox-history">'+(messages.length?messages.map(m=>'<article class="crm-inbox-message '+esc(m.direction)+'"><small>'+esc(m.sender_label||m.direction)+' · '+esc(fmt(m.received_at))+'</small><p>'+esc(m.body).replace(/\n/g,'<br>')+'</p></article>').join(''):'<p>No message history is available yet.</p>')+'</div><p class="crm-inbox-readonly">Read-only inbox: outgoing replies and sending are not enabled.</p>';
    }catch(e){$('crmInboxThread').innerHTML='<p>Could not load this conversation. Check database permissions.</p>';if(!quiet)notice(e.message||'Message history unavailable')}
  }
  const root=$('crmUnifiedInbox');if(!root||!db)return;
  root.hidden=false;root.style.display='block';
  const role=$('dashboard')?.dataset.crmRole||'';
  $('crmInboxDepartment').textContent=label[role]||'Authorized department';
  $('crmInboxSearch').addEventListener('input',renderList);
  $('crmInboxChannel').addEventListener('change',renderList);
  $('crmInboxStatus').addEventListener('change',renderList);
  $('crmInboxRefresh').addEventListener('click',()=>refresh());
  refresh();
  // Lightweight polling keeps the inbox fresh even if database Realtime publication is not enabled.
  const poll=window.setInterval(()=>{if(document.visibilityState==='visible')refresh(true)},30000);
  window.addEventListener('pagehide',()=>window.clearInterval(poll),{once:true});
})();
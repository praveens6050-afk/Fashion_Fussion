'use strict';
(function(){
  const $=id=>document.getElementById(id), db=window.supabaseClient;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label={customer_support:'Customer Support',seller_support:'Seller Support',sales:'Sales',marketing:'Marketing',administrator:'All Departments'};
  let conversations=[],selected=null,loading=false,sending=false;
  const role=$('dashboard')?.dataset.crmRole||'';
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
  async function refresh(quiet=false,syncZoho=false){
    if(loading)return;loading=true;
    try{
      let syncResult=null;
      if(syncZoho&&role==='administrator'){
        try{
          const{data,error}=await db.functions.invoke('crm-zoho-inbox-sync',{body:{}});
          if(error)throw new Error(error.message||'Zoho inbox sync unavailable');
          if(data?.error)throw new Error(data.error);
          syncResult=data;
        }catch(syncError){
          console.error('[CRM Zoho inbox sync]',syncError);
          if(!quiet)notice('Inbox loaded; Zoho sync needs attention ('+String(syncError.message||'sync failed')+').');
        }
      }
      const{data,error}=await db.from('crm_inbox_conversations').select('id,provider,department,contact_type,contact_name,contact_email,contact_phone,inbox_address,subject,latest_message,received_at,status,priority,assigned_to,metadata,last_inbound_at').order('received_at',{ascending:false}).limit(300);
      if(error)throw error;conversations=data||[];renderList();
      if(selected&&!conversations.some(c=>c.id===selected)){selected=null;$('crmInboxThread').innerHTML='<p>Select a conversation to view messages.</p>'}
      if(!quiet){
        const syncNote=syncResult?(' Zoho: '+syncResult.imported+' new email(s) imported.') : '';
        notice('Inbox refreshed at '+new Date().toLocaleTimeString()+'.'+syncNote+' Reply sending requires configured provider credentials.');
      }
      if(selected)await openThread(selected,true);
    }catch(e){notice('Inbox could not load. Verify migration, team role and provider webhook setup.');console.error('[CRM inbox]',e)}
    finally{loading=false}
  }
  async function sendReply(id){
    if(sending)return;
    const box=$('crmInboxReplyBody'),button=$('crmInboxSend'),body=String(box?.value||'').trim();
    if(!body){notice('Write a reply before sending.');return}
    const c=conversations.find(x=>x.id===id);if(!c)return;
    if(c.provider==='whatsapp'&&Date.now()-Date.parse(c.last_inbound_at||c.received_at)>24*60*60*1000){notice('WhatsApp customer-service window has expired. A pre-approved template sender must be configured before replying.');return}
    if(!window.crypto?.randomUUID){notice('This browser cannot safely create a unique send ID. Update the browser before sending.');return}
    sending=true;if(button){button.disabled=true;button.textContent='Sending…'}
    try{
      const {data,error}=await db.functions.invoke('crm-send-reply',{body:{conversation_id:id,request_id:crypto.randomUUID(),body,mode:'reply'}});
      if(error)throw new Error(error.message||'Reply endpoint unavailable');
      if(data?.error)throw new Error(data.error==='WHATSAPP_TEMPLATE_REQUIRED_OUTSIDE_24H'?'WhatsApp template required outside the 24-hour window.':data.error);
      if(!data?.ok)throw new Error('Provider did not confirm the message.');
      if(box)box.value='';
      notice((c.provider==='whatsapp'?'WhatsApp':'Email')+' accepted by provider. Message ID: '+(data.provider_message_id||'recorded'));
      await refresh(true);
    }catch(e){console.error('[CRM reply]',e);notice('Reply was not confirmed: '+String(e.message||'send failed')+'. Check provider setup and message history before retrying.')}
    finally{sending=false;if(button){button.disabled=false;button.textContent='Send '+providerName(c.provider)}}
  }
  async function openWhatsAppAttachment(button){
    const messageId=button.dataset.messageId,mime=button.dataset.mime||'',filename=button.dataset.name||'whatsapp-attachment';
    if(!messageId)return;
    const previous=button.textContent;button.disabled=true;button.textContent='Reading attachment…';notice('Retrieving attachment securely from WhatsApp…');
    try{
      const {data:{session},error}=await db.auth.getSession();
      if(error||!session?.access_token)throw new Error('Your CRM session expired. Sign in again.');
      const endpoint='https://gmdevprqtvoshbbytsxf.supabase.co/functions/v1/crm-whatsapp-media';
      const headers={Authorization:'Bearer '+session.access_token,apikey:'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA','Content-Type':'application/json'};
      const extractable=['text/plain','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'].includes(mime);
      if(extractable){
        const parsedResponse=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({provider_message_id:messageId,action:'extract'}),cache:'no-store'});
        if(parsedResponse.ok){
          const parsed=await parsedResponse.json();
          const panel=document.createElement('pre');panel.className='crm-wa-attachment-text';panel.textContent=String(parsed.text||'').slice(0,200000);panel.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto;padding:12px;border:1px solid #d0d5dd;border-radius:8px;background:#fff';
          button.closest('.crm-wa-attachment').querySelector('.crm-wa-attachment-text')?.remove();button.closest('.crm-wa-attachment').appendChild(panel);
          notice('Attachment text extracted successfully.'+(parsed.truncated?' Display limited to the first 200,000 characters.':''));return;
        }
        if(mime==='text/plain') {const detail=await parsedResponse.json().catch(()=>({}));throw new Error(detail.error||'Text file could not be read.');}
      }
      const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({provider_message_id:messageId,action:'download'}),cache:'no-store'});
      if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.error||'Attachment download failed (HTTP '+response.status+').')}
      const blob=await response.blob(),url=URL.createObjectURL(blob);
      if(mime.startsWith('image/')||mime==='application/pdf'){
        const opened=window.open(url,'_blank','noopener,noreferrer');
        if(!opened){const link=document.createElement('a');link.href=url;link.download=filename;link.rel='noopener';link.click();}
        window.setTimeout(()=>URL.revokeObjectURL(url),60000);notice('Attachment opened for preview.');
      }else{
        const link=document.createElement('a');link.href=url;link.download=filename;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();
        window.setTimeout(()=>URL.revokeObjectURL(url),60000);notice('Attachment downloaded. Legacy Word (.doc) files require a compatible document reader.');
      }
    }catch(error){notice('Attachment could not be read: '+String(error?.message||error));}
    finally{button.disabled=false;button.textContent=previous;}
  }
  async function openThread(id,quiet=false){
    selected=id;const c=conversations.find(x=>x.id===id);if(!c)return;
    renderList();$('crmInboxThread').innerHTML='<h3>'+esc(c.contact_name||c.contact_email||c.contact_phone||'Unknown contact')+'</h3><p>Loading message history…</p>';
    try{
      const{data,error}=await db.from('crm_inbox_messages').select('id,direction,sender_label,body,received_at,delivery_status,provider_message_id,metadata').eq('conversation_id',id).order('received_at',{ascending:true}).limit(100);
      if(error)throw error;
      const messages=data||[];
      // The server validates CRM role and the explicit test-send gate before contacting a provider.
      const canReply=true;
      const expired=c.provider==='whatsapp'&&Date.now()-Date.parse(c.last_inbound_at||c.received_at)>24*60*60*1000;
      const attachmentMarkup=m=>{const a=m?.metadata?.whatsapp_attachment;if(!a?.media_id)return '';const supported=!!a.supported&&!!a.mime_type;return '<div class="crm-wa-attachment" style="margin:10px 0;padding:10px;border:1px solid #d0d5dd;border-radius:8px"><strong>Attachment: '+esc(a.filename||a.mime_type||'WhatsApp file')+'</strong><p>'+esc(a.mime_type||'Unknown type')+' · '+(supported?'Available securely':'Unsupported file type')+'</p>'+(supported?'<button type="button" class="crm-wa-attachment-open" data-message-id="'+esc(m.provider_message_id)+'" data-mime="'+esc(a.mime_type)+'" data-name="'+esc(a.filename||'whatsapp-attachment')+'">Open / read attachment</button>':'')+'</div>'};
      const history=messages.map(m=>'<article class="crm-inbox-message '+esc(m.direction)+'"><small>'+esc(m.sender_label||m.direction)+' · '+esc(fmt(m.received_at))+' · '+esc(m.delivery_status||'received')+'</small><p>'+esc(m.body).replace(/\n/g,'<br>')+'</p>'+attachmentMarkup(m)+'</article>').join('');
      $('crmInboxThread').innerHTML='<div class="crm-inbox-thread-head"><div><h3>'+esc(c.contact_name||c.contact_email||c.contact_phone||'Unknown contact')+'</h3><p>'+esc(c.contact_email||'')+(c.contact_phone?' · '+esc(c.contact_phone):'')+'</p></div><span class="crm-inbox-channel">'+esc(providerName(c.provider))+'</span></div><p><strong>'+esc(c.subject||'Incoming email')+'</strong></p><div class="crm-inbox-history">'+(history||'<p>No message history is available yet.</p>')+'</div>'+(canReply?'<form id="crmInboxReplyForm" class="crm-inbox-reply"><label for="crmInboxReplyBody">Reply via '+esc(providerName(c.provider))+'</label><textarea id="crmInboxReplyBody" rows="4" maxlength="4000" required placeholder="Write a reply…"></textarea><div class="crm-inbox-reply-actions"><span class="crm-inbox-reply-hint">'+(expired?'24-hour WhatsApp window expired; templates are required.':'Reply availability is checked by the server-side send gate.')+'</span><button id="crmInboxSend" type="submit" '+(expired?'disabled':'')+'>Send '+esc(providerName(c.provider))+'</button></div></form>':'<p class="crm-inbox-readonly">Reply sending is disabled by the server-side test-send gate.</p>');
      const form=$('crmInboxReplyForm');if(form)form.addEventListener('submit',e=>{e.preventDefault();sendReply(id)});
      $('crmInboxThread').querySelectorAll('.crm-wa-attachment-open').forEach(button=>button.addEventListener('click',()=>openWhatsAppAttachment(button)));
    }catch(e){$('crmInboxThread').innerHTML='<p>Could not load this conversation. Check database permissions.</p>';if(!quiet)notice(e.message||'Message history unavailable')}
  }
  const root=$('crmUnifiedInbox');if(!root||!db)return;
  root.hidden=false;root.style.display='block';
  $('crmInboxDepartment').textContent=label[role]||'Authorized department';
  const deliveryButton=$('crmInboxDeliveryRefresh');
  if(deliveryButton&&role==='administrator'){
    deliveryButton.hidden=false;
    deliveryButton.addEventListener('click',async()=>{
      deliveryButton.disabled=true;deliveryButton.textContent='Checking…';notice('Checking Zoho recipient-server delivery logs…');
      try{
        const{data,error}=await db.functions.invoke('crm-zoho-delivery-sync',{body:{}});
        if(data?.error==='ZOHO_DELIVERY_SCOPE_REQUIRED')throw new Error('Reconnect Zoho Mail and approve the organization read-only permission to enable delivery tracking.');
        if(data?.error)throw new Error(data.error);
        if(error){let detail='';const response=error.context;if(response&&typeof response.clone==='function'){const body=await response.clone().json().catch(()=>null);if(body?.error){const meta=[body.provider_http_status?('Zoho HTTP '+body.provider_http_status):'',body.provider_code?('API '+String(body.provider_code).slice(0,48)):''].filter(Boolean).join(', ');detail=body.error+(meta?' ('+meta+')':'');}}throw new Error(detail||error.message||'Zoho delivery tracking unavailable')}
        await refresh(true);
        notice('Zoho delivery check complete: '+Number(data.updated||0)+' status update(s); '+Number(data.not_yet_reported||0)+' still awaiting Zoho.');
      }catch(e){console.error('[CRM Zoho delivery sync]',e);notice('Email delivery tracking could not refresh: '+String(e.message||e));}
      finally{deliveryButton.disabled=false;deliveryButton.textContent='Refresh email delivery'}
    });
  }
  $('crmInboxSearch').addEventListener('input',renderList);
  $('crmInboxChannel').addEventListener('change',renderList);
  $('crmInboxStatus').addEventListener('change',renderList);
  $('crmInboxRefresh').addEventListener('click',()=>refresh(false,role==='administrator'));
  refresh(false,role==='administrator');
  const poll=window.setInterval(()=>{if(document.visibilityState==='visible')refresh(true)},30000);
  const zohoPoll=window.setInterval(()=>{if(role==='administrator'&&document.visibilityState==='visible')refresh(true,true)},5*60*1000);
  window.addEventListener('pagehide',()=>{window.clearInterval(poll);window.clearInterval(zohoPoll)},{once:true});
})();


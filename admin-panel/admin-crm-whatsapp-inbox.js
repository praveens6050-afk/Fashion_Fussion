'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>v?new Date(v).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
  const isSystemNotification=row=>{
    const sender=String(row?.sender_email||'').trim().toLowerCase();
    const subject=String(row?.subject||'').toLowerCase();
    return /@zohoaccounts\.in$/.test(sender)
      || (subject.includes('zoho account')&&(subject.includes('sign-in')||subject.includes('multi-factor authentication')));
  };
  let rows=[];let actorTeam='';let isAdmin=false;let pendingWhatsappRequest=null;let pendingWhatsappBody='';
  function mount(){
    const container=$('dashboard')?.querySelector('.container');
    if(!container||$('ffWhatsAppSupportInbox'))return;
    const section=document.createElement('section');
    section.id='ffWhatsAppSupportInbox';section.className='card';
    section.innerHTML='<div class="card-header"><div><h2>WhatsApp Support Inbox</h2><p>Customer, seller, sales/marketing and admin conversations. Replies use the authenticated CRM sender and its server-side safety checks.</p></div><button type="button" class="secondary" id="ffWaInboxRefresh">Refresh inbox</button></div><div class="card-body"><div class="ff-wa-queue-counts" id="ffWaQueueCounts"></div><div class="ff-wa-inbox-layout"><div><label for="ffWaTeamFilter">Team queue</label><select id="ffWaTeamFilter"><option value="all">All queues</option><option value="customer_support">Customer support</option><option value="seller_support">Seller support</option><option value="sales_marketing">Sales / marketing</option><option value="admin_operations">Admin operations</option><option value="needs_review">Needs identity review</option></select><div id="ffWaInboxRows" aria-live="polite">Loading…</div></div><div class="ff-wa-conversation"><h3 id="ffWaSelectedTitle">Select a conversation</h3><p class="ff-wa-meta" id="ffWaSelectedMeta">Your assigned team or administrator permissions control message access.</p><div class="ff-wa-message" id="ffWaSelectedMessage">No conversation selected.</div><label for="ffWaReplyText">Reply draft (max 1000 characters)</label><textarea id="ffWaReplyText" maxlength="1000" rows="5" placeholder="Write a reply…"></textarea><div class="ff-wa-reply-actions"><span id="ffWaReplyCount">0 / 1000</span><button type="button" class="primary" id="ffWaSendReply" disabled>Send WhatsApp</button></div><p id="ffWaInboxStatus" role="status" aria-live="polite"></p><p class="ff-wa-note">Replies go through the authenticated CRM sender. The server checks team access, provider setup, the WhatsApp 24-hour window, and the send approval gate.</p></div></div><section id="ffWaTeamAdmin" hidden style="margin-top:18px;border-top:1px solid #eaecf0;padding-top:16px"><h3>Team access administration</h3><p>Assign an existing Supabase Auth user by UUID. Team members receive access only to their assigned support queue, not the full CRM.</p><label for="ffWaMemberId">User UUID</label><input id="ffWaMemberId" autocomplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"><label for="ffWaMemberTeam">Team</label><select id="ffWaMemberTeam"><option value="customer_support">Customer support</option><option value="seller_support">Seller support</option><option value="sales_marketing">Sales / marketing</option></select><label><input id="ffWaMemberActive" type="checkbox" checked style="display:inline;width:auto;margin-right:8px">Active team access</label><button type="button" class="secondary" id="ffWaAssignTeam">Save team access</button><p id="ffWaTeamStatus" role="status"></p></section></div>';
    const style=document.createElement('style');
    style.textContent='#ffWhatsAppSupportInbox{margin-top:20px}#ffWhatsAppSupportInbox .ff-wa-queue-counts{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}#ffWhatsAppSupportInbox .ff-wa-queue-counts span{padding:9px 12px;border-radius:8px;background:#f2f4f7;font-size:12px}#ffWhatsAppSupportInbox .ff-wa-queue-counts b{display:block;font-size:18px}#ffWhatsAppSupportInbox .ff-wa-inbox-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}#ffWhatsAppSupportInbox select,#ffWhatsAppSupportInbox textarea{display:block;width:100%;box-sizing:border-box;margin:7px 0 12px;padding:10px;border:1px solid #d0d5dd;border-radius:8px;font:inherit}#ffWhatsAppSupportInbox .ff-wa-row{display:block;width:100%;text-align:left;border:1px solid #eaecf0;border-radius:8px;background:#fff;padding:12px;margin-top:8px;cursor:pointer;color:inherit}#ffWhatsAppSupportInbox .ff-wa-row[aria-pressed=true]{border-color:#667085;background:#f8fafc}#ffWhatsAppSupportInbox .ff-wa-row strong{display:block;margin-bottom:4px}#ffWhatsAppSupportInbox .ff-wa-muted{font-size:12px;color:#667085;margin-top:4px;overflow-wrap:anywhere}#ffWhatsAppSupportInbox .ff-wa-conversation{border:1px solid #eaecf0;border-radius:10px;padding:14px;min-width:0}#ffWhatsAppSupportInbox .ff-wa-message{white-space:pre-wrap;overflow-wrap:anywhere;min-height:90px;background:#f8fafc;padding:12px;border-radius:8px;margin:12px 0 18px}#ffWhatsAppSupportInbox .ff-wa-reply-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}#ffWhatsAppSupportInbox .ff-wa-note{font-size:12px;color:#667085}#ffWhatsAppSupportInbox .ff-wa-pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#f2f4f7;font-size:11px}@media(max-width:900px){#ffWhatsAppSupportInbox .ff-wa-inbox-layout{grid-template-columns:1fr}}';
    document.head.appendChild(style);container.appendChild(section);
    const emailSection=document.createElement('section');emailSection.id='ffCrmEmailInbox';emailSection.className='card';emailSection.style.marginTop='18px';
    emailSection.innerHTML='<div class="card-header"><div><h2>Zoho Mail Support Inbox</h2><p>Incoming mail staged from approved support mailboxes. Review identity before drafting a reply; no email is sent from this screen.</p></div><button type="button" class="secondary" id="ffEmailRefresh">Refresh email</button></div><div class="card-body"><div class="ff-wa-inbox-layout"><div><label for="ffEmailTeamFilter">Team queue</label><select id="ffEmailTeamFilter"><option value="all">All queues</option><option value="customer_support">Customer support</option><option value="seller_support">Seller support</option><option value="sales_marketing">Sales / marketing</option><option value="admin_operations">Orders / admin operations</option></select><div id="ffEmailRows" aria-live="polite">Loading…</div></div><div class="ff-wa-conversation"><h3 id="ffEmailSelectedTitle">Select an email</h3><p id="ffEmailSelectedMeta">Team-scoped email content.</p><div class="ff-wa-message" id="ffEmailSelectedMessage">No email selected.</div><button type="button" class="secondary" id="ffEmailClassify" disabled>Confirm identity / classify</button><button type="button" class="secondary" id="ffEmailApproveReply" hidden disabled>Approve latest email reply</button><button type="button" class="primary" id="ffEmailSendReply" hidden disabled>Send approved email</button><label for="ffEmailReplyText">Reply draft (max 10000 characters)</label><textarea id="ffEmailReplyText" maxlength="10000" rows="5" placeholder="Write a reply…"></textarea><button type="button" class="primary" id="ffEmailQueueReply" disabled>Queue email reply for review</button><p id="ffEmailStatus" role="status" aria-live="polite"></p><p class="ff-wa-note">Email replies remain pending review. Zoho OAuth sending and delivery tracking are not enabled by this inbox.</p></div></div></div>';
    container.appendChild(emailSection);
    $('ffWaInboxRefresh').addEventListener('click',load);
    $('ffWaTeamFilter').addEventListener('change',renderRows);
    $('ffWaReplyText').addEventListener('input',()=>{$('ffWaReplyCount').textContent=$('ffWaReplyText').value.length+' / 1000';updateWhatsAppSendButton();});
    $('ffWaSendReply').addEventListener('click',sendWhatsAppReply);
    $('ffWaAssignTeam').addEventListener('click',assignTeam);
    $('ffEmailRefresh').addEventListener('click',loadEmail);
    $('ffEmailTeamFilter').addEventListener('change',renderEmails);
    $('ffEmailClassify').addEventListener('click',classifyEmail);
    $('ffEmailApproveReply').addEventListener('click',approveEmailReply);
    $('ffEmailSendReply').addEventListener('click',sendEmailReply);
    $('ffEmailQueueReply').addEventListener('click',queueEmailReply);
    load();loadEmail();
  }
  async function callApi(payload){
    const db=window.supabaseClient;if(!db?.auth)throw new Error('CRM session is unavailable.');
    const {data:{session},error}=await db.auth.getSession();
    if(error||!session?.access_token)throw new Error('Please sign in again.');
    const response=await fetch('/api/admin-crm-whatsapp-inbox',{method:'POST',
      headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
      body:JSON.stringify(payload),cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'CRM support inbox unavailable.');
    return result.data||{};
  }
  async function load(){
    $('ffWaInboxStatus').textContent='Loading WhatsApp support inbox…';
    $('ffWaSendReply').disabled=true;
    try{
      const data=await callApi({action:'snapshot'});
      actorTeam=String(data.actor_team||'');isAdmin=data.is_admin===true;
      const db=window.supabaseClient;
      const {data:conversations,error}=await db.from('crm_inbox_conversations')
        .select('id,provider,department,contact_type,contact_phone,latest_message,received_at,last_inbound_at,status')
        .eq('provider','whatsapp').order('received_at',{ascending:false}).limit(100);
      if(error)throw error;
      const canRead=c=>isAdmin||c.department===actorTeam
        ||(actorTeam==='sales_marketing'&&['sales','marketing'].includes(c.department));
      rows=(conversations||[]).filter(canRead).map(c=>({
        id:Number(c.id),support_team:['sales','marketing'].includes(c.department)?'sales_marketing':c.department,
        routing_status:c.status||'open',sender_role:c.contact_type||'unknown',sender_phone:c.contact_phone||'',
        message_text:c.latest_message||'',created_at:c.received_at,last_inbound_at:c.last_inbound_at||c.received_at
      }));
      $('ffWaTeamAdmin').hidden=true;
      const filter=$('ffWaTeamFilter');
      [...filter.options].forEach(option=>{if(option.value==='all')option.textContent=isAdmin?'All queues':'My team queue';});
      [...filter.options].forEach(option=>{if(!['all','needs_review'].includes(option.value))option.hidden=!isAdmin&&option.value!==actorTeam;});
      const q=data.queues||{};
      $('ffWaQueueCounts').innerHTML=[
        ['Customer support',q.customer_support],['Seller support',q.seller_support],
        ['Sales / marketing',q.sales_marketing],...(isAdmin?[['Admin operations',q.admin_operations]]:[]),
        ['Needs review',q.needs_review]
      ].map(([name,n])=>'<span><b>'+Number(n||0)+'</b>'+esc(name)+'</span>').join('');
      renderRows();renderOverview();
      $('ffWaInboxStatus').textContent='Refreshed '+date(data.generated_at)+'. Select a conversation to reply.';
    }catch(e){
      $('ffWaInboxRows').textContent='Inbox unavailable.';
      $('ffWaInboxStatus').textContent=e.message||'Inbox unavailable.';
    }
  }
  function renderOverview(){
    const host=$('crmOverviewCounts');if(!host)return;
    const items=[...rows,...emailRows.filter(row=>!isSystemNotification(row))].filter(row=>isAdmin||row.support_team===actorTeam);
    const customer=items.filter(row=>row.support_team==='customer_support').length;
    const seller=items.filter(row=>row.support_team==='seller_support').length;
    const status=row=>String(row.routing_status||'open').toLowerCase();
    const resolved=items.filter(row=>['closed','resolved','complete','completed'].includes(status(row))).length;
    const pending=items.filter(row=>['assigned','waiting','needs_review','pending'].includes(status(row))).length;
    const open=items.filter(row=>status(row)==='open').length;
    host.innerHTML=[['Customer support',customer],['Seller support',seller],['Open',open],['Resolved',resolved],['Pending',pending]]
      .map(([label,count])=>'<span><b>'+Number(count||0)+'</b>'+esc(label)+'</span>').join('');
  }
  function renderRows(){
    const target=$('ffWaInboxRows');if(!target)return;
    const filter=$('ffWaTeamFilter').value;
    const filtered=rows.filter(r=>(isAdmin||r.support_team===actorTeam)&&(filter==='all'||(filter==='needs_review'?r.routing_status==='needs_review':r.support_team===filter)));
    if(!filtered.length){target.innerHTML='<p>No messages in this queue.</p>';return;}
    target.innerHTML=filtered.map(r=>'<button type="button" class="ff-wa-row" data-event="'+Number(r.id)+'" aria-pressed="false"><strong>'+esc(r.sender_role||'unknown')+' · '+esc(r.sender_phone||'')+'</strong><span class="ff-wa-pill">'+esc(r.support_team||'unassigned')+'</span> <span class="ff-wa-pill">'+esc(r.routing_status||'unknown')+'</span><div class="ff-wa-muted">'+esc(r.message_type||'message')+' · '+date(r.created_at)+'</div><div class="ff-wa-muted">'+esc(String(r.message_text||'[No text body]').slice(0,180))+'</div><div class="ff-wa-muted">Latest reply: '+esc(r.latest_reply_status||'none')+'</div></button>').join('');
    target.querySelectorAll('[data-event]').forEach(btn=>btn.addEventListener('click',()=>select(Number(btn.dataset.event),btn)));
  }
  async function openWaAttachment(button){
    const providerMessageId=button.dataset.messageId||'',attachmentId=button.dataset.attachmentId||'',mime=button.dataset.mime||'',filename=button.dataset.name||'attachment',action=button.dataset.action||'preview';
    if(!providerMessageId)return;
    const original=button.textContent;button.disabled=true;button.textContent='Loading…';
    const status=$('ffWaInboxStatus');
    try{
      const db=window.supabaseClient;
      const {data:{session},error:sessionError}=await db.auth.getSession();
      if(sessionError||!session?.access_token)throw new Error('CRM session expired. Sign in again.');
      const endpoint='https://gmdevprqtvoshbbytsxf.supabase.co/functions/v1/crm-whatsapp-media';
      const headers={Authorization:'Bearer '+session.access_token,apikey:'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA','Content-Type':'application/json'};
      const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({provider_message_id:providerMessageId,attachment_id:attachmentId||undefined,action:action==='extract'?'extract':'preview'}),cache:'no-store'});
      if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.error||'Attachment unavailable (HTTP '+response.status+').');}
      if(action==='extract'){
        const parsed=await response.json();
        const host=button.closest('.ff-wa-attachment')||button.parentElement;
        host.querySelector('.ff-wa-attachment-text')?.remove();
        const panel=document.createElement('pre');panel.className='ff-wa-attachment-text';panel.textContent=String(parsed.text||'').slice(0,200000);panel.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto;padding:12px;border:1px solid #d0d5dd;border-radius:8px;background:#fff';host.appendChild(panel);
        status.textContent=parsed.text?'PDF text extracted.':'No selectable text found in this PDF.';
        return;
      }
      const blob=await response.blob();
      if(action==='ocr'){
        if(!mime.startsWith('image/'))throw new Error('OCR is available only for image attachments.');
        if(blob.size>8*1024*1024)throw new Error('Image OCR limit is 8 MB. Open or download the image instead.');
        const host=button.closest('.ff-wa-attachment');host.querySelector('.ff-wa-attachment-text')?.remove();
        const panel=document.createElement('pre');panel.className='ff-wa-attachment-text';panel.textContent='Loading local OCR engine…';panel.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto;padding:12px;border:1px solid #d0d5dd;border-radius:8px;background:#fff';
        host.appendChild(panel);
        const {createWorker}=await import('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/+esm');
        const worker=await createWorker('eng');
        try{const result=await worker.recognize(blob);const text=String(result?.data?.text||'').trim();panel.textContent=text||'No readable text detected. Try a clearer image.';status.textContent=text?'Image text extracted in your browser. Verify any OTP manually; OCR can misread digits.':'No readable text detected.';}
        finally{await worker.terminate();}
        return;
      }
      const objectUrl=URL.createObjectURL(blob);
      if(mime.startsWith('image/')||mime==='application/pdf'){
        const opened=window.open(objectUrl,'_blank','noopener,noreferrer');
        if(!opened){const link=document.createElement('a');link.href=objectUrl;link.download=filename;link.rel='noopener';link.click();}
      }else{
        const link=document.createElement('a');link.href=objectUrl;link.download=filename;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();
      }
      window.setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
      status.textContent='Attachment opened or downloaded.';
    }catch(error){status.textContent='Attachment could not be read: '+String(error?.message||error);}
    finally{button.disabled=false;button.textContent=original;}
  }
  function attachmentMarkup(message){
    const meta=message?.metadata&&typeof message.metadata==='object'?message.metadata:{};
    const attachment=meta.whatsapp_attachment&&typeof meta.whatsapp_attachment==='object'?meta.whatsapp_attachment:null;
    const type=String(meta.message_type||'').toLowerCase();
    if(!attachment?.media_id){
      if(['image','document','video','audio','sticker'].includes(type)||String(message?.body||'').includes('[Incoming image message')){
        return '<div class="ff-wa-attachment"><strong>Attachment reference missing</strong><p>This older message has no saved WhatsApp media reference, so CRM cannot retrieve its image. Ask the sender to resend the image in WhatsApp; the new message will include a secure attachment link.</p></div>';
      }
      return '';
    }
    const mime=String(attachment.mime_type||'').toLowerCase();
    const supported=attachment.supported===true&&!!mime;
    const attrs=' data-message-id="'+esc(message.provider_message_id||'')+'" data-mime="'+esc(mime)+'" data-name="'+esc(attachment.filename||'whatsapp-attachment')+'"';
    const image=supported&&mime.startsWith('image/');
    return '<div class="ff-wa-attachment" style="margin:10px 0;padding:10px;border:1px solid #d0d5dd;border-radius:8px"><strong>Attachment: '+esc(attachment.filename||mime||'WhatsApp file')+'</strong><p>'+esc(mime||'Unknown MIME type')+' · '+(supported?'Available securely':'Unsupported file type')+'</p>'+(supported?'<button type="button" class="ff-wa-attachment-open"'+attrs+'>Open / read attachment</button>'+(image?'<button type="button" class="ff-wa-attachment-open" data-action="ocr"'+attrs+'>Read image text / OTP</button>':''):'')+'</div>';
  }
  async function loadSelectedMessages(id){
    const host=$('ffWaSelectedMessage');host.textContent='Loading message history…';
    try{
      const db=window.supabaseClient;
      const {data,error}=await db.from('crm_inbox_messages').select('id,direction,sender_label,body,received_at,delivery_status,provider_message_id,metadata').eq('conversation_id',id).order('received_at',{ascending:true}).limit(100);
      if(error)throw error;
      if(Number($('ffWaSendReply').dataset.conversationId)!==Number(id))return;
      const messages=data||[];
      host.innerHTML=messages.length?messages.map(m=>'<article class="ff-wa-message-item" style="padding:10px 0;border-bottom:1px solid #eaecf0"><small>'+esc(m.sender_label||m.direction)+' · '+date(m.received_at)+' · '+esc(m.delivery_status||'received')+'</small><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(m.body||'[No text body]')+'</p>'+attachmentMarkup(m)+'</article>').join(''):'<p>No message history found for this conversation.</p>';
      host.querySelectorAll('.ff-wa-attachment-open').forEach(button=>button.addEventListener('click',()=>openWaAttachment(button)));
      if(!messages.length)$('ffWaInboxStatus').textContent='No message history found. Refresh the inbox or verify inbound webhook storage.';
    }catch(error){host.textContent='Message history could not load. Check CRM message-table access.';$('ffWaInboxStatus').textContent=String(error?.message||'Message history unavailable.');}
  }
  function select(id,button){
    const row=rows.find(r=>Number(r.id)===id);if(!row)return;
    $('ffWaInboxRows').querySelectorAll('[data-event]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    $('ffWaSelectedTitle').textContent=(row.sender_role||'Unknown sender')+' · '+(row.sender_phone||'');
    $('ffWaSelectedMeta').textContent=(row.support_team||'unassigned')+' · '+(row.routing_status||'unknown')+' · '+date(row.created_at);
    $('ffWaSendReply').dataset.conversationId=String(id);
    $('ffWaSelectedMessage').textContent='Loading message history…';
    loadSelectedMessages(id);
    $('ffWaReplyText').value='';$('ffWaReplyCount').textContent='0 / 1000';
    pendingWhatsappRequest=null;pendingWhatsappBody='';
    const expired=Date.now()-Date.parse(row.last_inbound_at||row.created_at)>24*60*60*1000;
    $('ffWaInboxStatus').textContent=expired?'The 24-hour WhatsApp service window has expired; a template reply is required.':'Reply is ready to send through the CRM provider workflow.';
    updateWhatsAppSendButton();
  }
  function updateWhatsAppSendButton(){
    const button=$('ffWaSendReply'),row=rows.find(r=>Number(r.id)===Number(button?.dataset.conversationId));
    const expired=row&&Date.now()-Date.parse(row.last_inbound_at||row.created_at)>24*60*60*1000;
    const text=$('ffWaReplyText').value.trim(),samePendingBody=!pendingWhatsappRequest||pendingWhatsappBody===text;
    if(button)button.disabled=!row||!text||Boolean(expired)||!samePendingBody;
  }
  let emailRows=[],selectedEmailId=null;
  async function loadEmail(){
    $('ffEmailStatus').textContent='Loading Zoho Mail inbox…';
    try{
      const data=await callApi({action:'snapshot_email'});
      emailRows=Array.isArray(data.recent)?data.recent:[];
      const filter=$('ffEmailTeamFilter');
      [...filter.options].forEach(option=>{if(option.value==='all')option.textContent=data.is_admin?'All queues':'My team queue';});
      [...filter.options].forEach(option=>{if(option.value!=='all')option.hidden=!data.is_admin&&option.value!==data.actor_team;});
      renderEmails();renderOverview();
      $('ffEmailStatus').textContent='Email inbox refreshed '+date(data.generated_at)+'. Read-only mode; no email sent.';
    }catch(e){$('ffEmailRows').textContent='Email inbox unavailable.';$('ffEmailStatus').textContent=e.message||'Email inbox unavailable.';}
  }
  function renderEmails(){
    const target=$('ffEmailRows');if(!target)return;
    const filter=$('ffEmailTeamFilter').value;
    const filtered=emailRows.filter(r=>(isAdmin||r.support_team===actorTeam)&&(filter==='all'||r.support_team===filter));
    if(!filtered.length){target.innerHTML='<p>No incoming email in this queue.</p>';return;}
    target.innerHTML=filtered.map(r=>'<button type="button" class="ff-wa-row" data-email-event="'+Number(r.id)+'" aria-pressed="'+(Number(r.id)===selectedEmailId)+'"><strong>'+esc(r.subject||'(No subject)')+'</strong><span class="ff-wa-pill">'+esc(isSystemNotification(r)?'System notification':(r.support_team||'unassigned'))+'</span> <span class="ff-wa-pill">'+esc(isSystemNotification(r)?'Informational':(r.routing_status||'needs_review'))+'</span><div class="ff-wa-muted">From: '+esc(r.sender_email||'')+'</div><div class="ff-wa-muted">To: '+esc(r.recipient_email||'')+' · '+date(r.received_at)+'</div><div class="ff-wa-muted">'+esc(String(r.message_text||'[No text body]').slice(0,180))+'</div></button>').join('');
    target.querySelectorAll('[data-email-event]').forEach(btn=>btn.addEventListener('click',()=>selectEmail(Number(btn.dataset.emailEvent))));
  }
  function selectEmail(id){
    const row=emailRows.find(r=>Number(r.id)===id);if(!row)return;selectedEmailId=id;
    $('ffEmailSelectedTitle').textContent=row.subject||'(No subject)';
    $('ffEmailSelectedMeta').textContent=(row.support_team||'unassigned')+' · '+(row.routing_status||'needs_review')+' · From '+(row.sender_email||'')+' · '+date(row.received_at);
    $('ffEmailSelectedMessage').textContent=row.message_text||'[No text body received]';
    loadEmailAttachments(id);
    $('ffEmailReplyText').value='';
    const systemNotice=isSystemNotification(row);
    $('ffEmailClassify').disabled=systemNotice||row.routing_status==='classified';
    $('ffEmailQueueReply').disabled=systemNotice||row.routing_status!=='classified';
    $('ffEmailApproveReply').hidden=true;
    $('ffEmailApproveReply').disabled=!isAdmin||!row.latest_reply_id||row.latest_reply_status!=='pending_review';
    $('ffEmailApproveReply').textContent=row.latest_reply_status==='ready'?'Email reply approved':'Approve latest email reply';
    $('ffEmailSendReply').hidden=true;
    $('ffEmailSendReply').disabled=!isAdmin||row.latest_reply_status!=='ready';
    $('ffEmailStatus').textContent=systemNotice?'System security notification. It is kept in Email inbox and excluded from support-ticket totals; replies are disabled.':(row.routing_status==='classified'?'Email reviewed; replies can be staged for review.':'Review the sender/content, then confirm classification before drafting a reply.');
    renderEmails();
  }
  function emailAttachmentMarkup(message,a){
    const mime=String(a?.mime_type||'').toLowerCase(),supported=a?.supported===true&&['application/pdf','image/jpeg','image/png','image/gif','image/webp'].includes(mime);
    const attrs=' data-message-id="'+esc(message.provider_message_id||'')+'" data-attachment-id="'+esc(a?.attachment_id||'')+'" data-mime="'+esc(mime)+'" data-name="'+esc(a?.filename||'attachment')+'"';
    return '<div class="ff-wa-attachment" style="margin:10px 0;padding:10px;border:1px solid #d0d5dd;border-radius:8px"><strong>'+esc(a?.filename||'Email attachment')+'</strong><p>'+esc(mime)+' · '+(supported?'Available securely':'Unsupported file type')+'</p>'+(supported?'<button type="button" class="ff-email-attachment-open" data-action="preview"'+attrs+'>Open / preview attachment</button>'+(mime==='application/pdf'?'<button type="button" class="ff-email-attachment-open" data-action="extract"'+attrs+'>Read PDF text</button>':'')+(mime.startsWith('image/')?'<button type="button" class="ff-email-attachment-open" data-action="ocr"'+attrs+'>Read image text</button>':''):'')+'</div>';
  }
  async function loadEmailAttachments(id){
    const host=$('ffEmailSelectedMessage');let panel=$('ffEmailAttachmentList');
    if(!panel){panel=document.createElement('div');panel.id='ffEmailAttachmentList';host.insertAdjacentElement('afterend',panel);}
    panel.textContent='Checking email attachments…';
    try{
      const db=window.supabaseClient;
      const {data,error}=await db.from('crm_inbox_messages').select('provider_message_id,metadata').eq('conversation_id',id).eq('direction','inbound').order('received_at',{ascending:false}).limit(10);
      if(error)throw error;
      const messages=data||[],attachments=messages.flatMap(m=>(Array.isArray(m.metadata?.zoho_attachments)?m.metadata.zoho_attachments:[]).map(a=>({message:m,attachment:a})));
      panel.innerHTML=attachments.length?'<strong>Email attachment(s)</strong>'+attachments.map(x=>emailAttachmentMarkup(x.message,x.attachment)).join(''):'<p>No image or PDF attachment is available on this email.</p>';
      panel.querySelectorAll('.ff-email-attachment-open').forEach(button=>button.addEventListener('click',()=>openWaAttachment(button)));
    }catch(error){panel.textContent='Email attachments could not load: '+String(error?.message||error);}
  }
  async function classifyEmail(){
    if(!selectedEmailId)return;
    $('ffEmailClassify').disabled=true;$('ffEmailStatus').textContent='Saving review…';
    try{await callApi({action:'classify_email',inboundEventId:selectedEmailId});await loadEmail();selectEmail(selectedEmailId);}
    catch(e){$('ffEmailClassify').disabled=false;$('ffEmailStatus').textContent=e.message||'Could not classify email.';}
  }
  async function sendEmailReply(){
    const row=emailRows.find(r=>Number(r.id)===selectedEmailId);
    if(!isAdmin||!row?.latest_reply_id||row.latest_reply_status!=='ready')return;
    if(!confirm('Send this approved email reply now? It will only proceed if all server-side launch gates are enabled.'))return;
    $('ffEmailSendReply').disabled=true;$('ffEmailStatus').textContent='Checking gated Zoho dispatch…';
    try{
      const result=await callApi({action:'send_approved_email_reply',replyId:Number(row.latest_reply_id)});
      $('ffEmailStatus').textContent=result.message||result.error||'Dispatch request completed.';
      await loadEmail();if(selectedEmailId)selectEmail(selectedEmailId);
    }catch(e){$('ffEmailStatus').textContent=e.message||'Email dispatch failed.';$('ffEmailSendReply').disabled=false;}
  }
  async function queueEmailReply(){
    if(!selectedEmailId)return;const reply=$('ffEmailReplyText').value.trim();
    if(!reply||reply.length>10000)return;
    $('ffEmailQueueReply').disabled=true;$('ffEmailStatus').textContent='Queueing email reply for review…';
    try{
      const key='crm-email-reply:'+selectedEmailId+':'+Date.now()+':'+Math.random().toString(36).slice(2,10);
      const result=await callApi({action:'queue_email_reply',inboundEventId:selectedEmailId,replyText:reply,requestKey:key});
      $('ffEmailReplyText').value='';$('ffEmailStatus').textContent=result.message||'Email reply queued for review; no email sent.';
    }catch(e){$('ffEmailStatus').textContent=e.message||'Could not queue email reply.';$('ffEmailQueueReply').disabled=false;}
  }
  async function assignTeam(){
    const userId=$('ffWaMemberId').value.trim(),teamKey=$('ffWaMemberTeam').value,active=$('ffWaMemberActive').checked;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)){
      $('ffWaTeamStatus').textContent='Enter a valid Supabase Auth user UUID.';return;
    }
    $('ffWaAssignTeam').disabled=true;$('ffWaTeamStatus').textContent='Saving team access…';
    try{
      const result=await callApi({action:'assign_team',userId,teamKey,active});
      $('ffWaTeamStatus').textContent=result.message||('Team access saved: '+teamKey+(active?' (active)':' (inactive)')+'.');
      $('ffWaMemberId').value='';
    }catch(e){$('ffWaTeamStatus').textContent=e.message||'Could not save team access.';}
    finally{$('ffWaAssignTeam').disabled=false;}
  }
  async function sendWhatsAppReply(){
    const button=$('ffWaSendReply'),row=rows.find(r=>Number(r.id)===Number(button.dataset.conversationId));
    const reply=$('ffWaReplyText').value.trim(),db=window.supabaseClient;
    if(!row||!reply||!db?.functions||!window.crypto?.randomUUID)return;
    if(Date.now()-Date.parse(row.last_inbound_at||row.created_at)>24*60*60*1000){
      $('ffWaInboxStatus').textContent='The 24-hour WhatsApp service window has expired; a template reply is required.';
      updateWhatsAppSendButton();return;
    }
    if(pendingWhatsappRequest&&pendingWhatsappBody!==reply){
      $('ffWaInboxStatus').textContent='The previous send was not confirmed. Refresh message history before changing or retrying this reply.';return;
    }
    if(!pendingWhatsappRequest){pendingWhatsappRequest=window.crypto.randomUUID();pendingWhatsappBody=reply;}
    button.disabled=true;$('ffWaInboxStatus').textContent='Sending through the CRM provider workflow…';
    try{
      const {data,error}=await db.functions.invoke('crm-send-reply',{body:{
        conversation_id:row.id,request_id:pendingWhatsappRequest,body:reply,mode:'reply'
      }});
      if(error)throw new Error(data?.error||error.message||'WhatsApp reply was not confirmed');
      if(data?.error)throw new Error(data.error);
      if(!data?.ok||data.provider!=='whatsapp')throw new Error('WhatsApp provider did not confirm this reply');
      $('ffWaReplyText').value='';$('ffWaReplyCount').textContent='0 / 1000';
      pendingWhatsappRequest=null;pendingWhatsappBody='';
      $('ffWaInboxStatus').textContent='WhatsApp accepted by provider. Message ID: '+(data.provider_message_id||'recorded');
      await load();
    }catch(e){
      $('ffWaInboxStatus').textContent='Reply was not confirmed: '+String(e.message||e)+'. Check message history before retrying.';
    }finally{
      button.disabled=false;updateWhatsAppSendButton();
    }
  }
  async function approveEmailReply(){
    const row=emailRows.find(r=>Number(r.id)===selectedEmailId);
    if(!isAdmin||!row?.latest_reply_id)return;
    $('ffEmailApproveReply').disabled=true;$('ffEmailStatus').textContent='Approving email reply for gated dispatch…';
    try{const result=await callApi({action:'approve_email_reply',replyId:Number(row.latest_reply_id)});$('ffEmailStatus').textContent=result.message||'Email reply approved; no email sent.';await loadEmail();if(selectedEmailId)selectEmail(selectedEmailId);}
    catch(e){$('ffEmailStatus').textContent=e.message||'Email reply approval failed.';$('ffEmailApproveReply').disabled=false;}
  }
  document.addEventListener('ff-crm-ready',mount);
  if(document.readyState!=='loading'&&$('dashboard')?.dataset.adminReady==='true')mount();
})();


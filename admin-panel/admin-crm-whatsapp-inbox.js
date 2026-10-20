'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>v?new Date(v).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
  let rows=[];let actorTeam='';let isAdmin=false;
  function mount(){
    const container=$('dashboard')?.querySelector('.container');
    if(!container||$('ffWhatsAppSupportInbox'))return;
    const section=document.createElement('section');
    section.id='ffWhatsAppSupportInbox';section.className='card';
    section.innerHTML='<div class="card-header"><div><h2>WhatsApp Support Inbox</h2><p>Customer, seller, sales/marketing and admin conversations. Replies are queued for review; this screen does not send WhatsApp messages.</p></div><button type="button" class="secondary" id="ffWaInboxRefresh">Refresh inbox</button></div><div class="card-body"><div class="ff-wa-queue-counts" id="ffWaQueueCounts"></div><div class="ff-wa-inbox-layout"><div><label for="ffWaTeamFilter">Team queue</label><select id="ffWaTeamFilter"><option value="all">All queues</option><option value="customer_support">Customer support</option><option value="seller_support">Seller support</option><option value="sales_marketing">Sales / marketing</option><option value="admin_operations">Admin operations</option><option value="needs_review">Needs identity review</option></select><div id="ffWaInboxRows" aria-live="polite">Loading…</div></div><div class="ff-wa-conversation"><h3 id="ffWaSelectedTitle">Select a conversation</h3><p class="ff-wa-meta" id="ffWaSelectedMeta">Your assigned team or administrator permissions control message access.</p><div class="ff-wa-message" id="ffWaSelectedMessage">No conversation selected.</div><div id="ffWaIdentityReview" hidden style="margin:10px 0;padding:12px;border:1px solid #eaecf0;border-radius:8px"><strong>Unrecognized WhatsApp sender</strong><p>Confirm the sender role before any reply can be queued.</p><label for="ffWaIdentityRole">Verified role</label><select id="ffWaIdentityRole"><option value="customer">Customer</option><option value="seller">Seller</option><option value="admin">Admin</option></select><button type="button" class="secondary" id="ffWaClassifyIdentity">Save identity review</button></div><label for="ffWaReplyText">Reply draft (max 1000 characters)</label><textarea id="ffWaReplyText" maxlength="1000" rows="5" placeholder="Write a reply…"></textarea><div class="ff-wa-reply-actions"><span id="ffWaReplyCount">0 / 1000</span><button type="button" class="secondary" id="ffWaApproveReply" hidden disabled>Approve latest reply</button><button type="button" class="primary" id="ffWaSendReply" hidden disabled>Send approved reply</button><button type="button" class="primary" id="ffWaQueueReply" disabled>Queue reply for review</button></div><p id="ffWaInboxStatus" role="status" aria-live="polite"></p><p class="ff-wa-note">Replies are saved as <b>pending review</b>. Sending and retries remain disabled until the approved dispatch workflow is configured.</p></div></div><section id="ffWaTeamAdmin" hidden style="margin-top:18px;border-top:1px solid #eaecf0;padding-top:16px"><h3>Team access administration</h3><p>Assign an existing Supabase Auth user by UUID. Team members receive access only to their assigned support queue, not the full CRM.</p><label for="ffWaMemberId">User UUID</label><input id="ffWaMemberId" autocomplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"><label for="ffWaMemberTeam">Team</label><select id="ffWaMemberTeam"><option value="customer_support">Customer support</option><option value="seller_support">Seller support</option><option value="sales_marketing">Sales / marketing</option></select><label><input id="ffWaMemberActive" type="checkbox" checked style="display:inline;width:auto;margin-right:8px">Active team access</label><button type="button" class="secondary" id="ffWaAssignTeam">Save team access</button><p id="ffWaTeamStatus" role="status"></p></section></div>';
    const style=document.createElement('style');
    style.textContent='#ffWhatsAppSupportInbox{margin-top:20px}#ffWhatsAppSupportInbox .ff-wa-queue-counts{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}#ffWhatsAppSupportInbox .ff-wa-queue-counts span{padding:9px 12px;border-radius:8px;background:#f2f4f7;font-size:12px}#ffWhatsAppSupportInbox .ff-wa-queue-counts b{display:block;font-size:18px}#ffWhatsAppSupportInbox .ff-wa-inbox-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}#ffWhatsAppSupportInbox select,#ffWhatsAppSupportInbox textarea{display:block;width:100%;box-sizing:border-box;margin:7px 0 12px;padding:10px;border:1px solid #d0d5dd;border-radius:8px;font:inherit}#ffWhatsAppSupportInbox .ff-wa-row{display:block;width:100%;text-align:left;border:1px solid #eaecf0;border-radius:8px;background:#fff;padding:12px;margin-top:8px;cursor:pointer;color:inherit}#ffWhatsAppSupportInbox .ff-wa-row[aria-pressed=true]{border-color:#667085;background:#f8fafc}#ffWhatsAppSupportInbox .ff-wa-row strong{display:block;margin-bottom:4px}#ffWhatsAppSupportInbox .ff-wa-muted{font-size:12px;color:#667085;margin-top:4px;overflow-wrap:anywhere}#ffWhatsAppSupportInbox .ff-wa-conversation{border:1px solid #eaecf0;border-radius:10px;padding:14px;min-width:0}#ffWhatsAppSupportInbox .ff-wa-message{white-space:pre-wrap;overflow-wrap:anywhere;min-height:90px;background:#f8fafc;padding:12px;border-radius:8px;margin:12px 0 18px}#ffWhatsAppSupportInbox .ff-wa-reply-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}#ffWhatsAppSupportInbox .ff-wa-note{font-size:12px;color:#667085}#ffWhatsAppSupportInbox .ff-wa-pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#f2f4f7;font-size:11px}@media(max-width:900px){#ffWhatsAppSupportInbox .ff-wa-inbox-layout{grid-template-columns:1fr}}';
    document.head.appendChild(style);container.appendChild(section);
    const emailSection=document.createElement('section');emailSection.id='ffCrmEmailInbox';emailSection.className='card';emailSection.style.marginTop='18px';
    emailSection.innerHTML='<div class="card-header"><div><h2>Zoho Mail Support Inbox</h2><p>Incoming mail staged from approved support mailboxes. Review identity before drafting a reply; no email is sent from this screen.</p></div><button type="button" class="secondary" id="ffEmailRefresh">Refresh email</button></div><div class="card-body"><div class="ff-wa-inbox-layout"><div><label for="ffEmailTeamFilter">Team queue</label><select id="ffEmailTeamFilter"><option value="all">All queues</option><option value="customer_support">Customer support</option><option value="seller_support">Seller support</option><option value="sales_marketing">Sales / marketing</option><option value="admin_operations">Orders / admin operations</option></select><div id="ffEmailRows" aria-live="polite">Loading…</div></div><div class="ff-wa-conversation"><h3 id="ffEmailSelectedTitle">Select an email</h3><p id="ffEmailSelectedMeta">Team-scoped email content.</p><div class="ff-wa-message" id="ffEmailSelectedMessage">No email selected.</div><button type="button" class="secondary" id="ffEmailClassify" disabled>Confirm identity / classify</button><button type="button" class="secondary" id="ffEmailApproveReply" hidden disabled>Approve latest email reply</button><button type="button" class="primary" id="ffEmailSendReply" hidden disabled>Send approved email</button><label for="ffEmailReplyText">Reply draft (max 10000 characters)</label><textarea id="ffEmailReplyText" maxlength="10000" rows="5" placeholder="Write a reply…"></textarea><button type="button" class="primary" id="ffEmailQueueReply" disabled>Queue email reply for review</button><p id="ffEmailStatus" role="status" aria-live="polite"></p><p class="ff-wa-note">Email replies remain pending review. Zoho OAuth sending and delivery tracking are not enabled by this inbox.</p></div></div></div>';
    container.appendChild(emailSection);
    $('ffWaInboxRefresh').addEventListener('click',load);
    $('ffWaTeamFilter').addEventListener('change',renderRows);
    $('ffWaReplyText').addEventListener('input',()=>{$('ffWaReplyCount').textContent=$('ffWaReplyText').value.length+' / 1000';});
    $('ffWaQueueReply').addEventListener('click',queueReply);
    $('ffWaClassifyIdentity').addEventListener('click',classifyWhatsApp);
    $('ffWaApproveReply').addEventListener('click',approveWhatsAppReply);
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
    const db=window.supabaseClient;
    if(!db?.auth)throw new Error('CRM session is unavailable.');
    const {data:{user},error:userError}=await db.auth.getUser();
    if(userError||!user)throw new Error('Please sign in again.');
    const [{data:profile,error:profileError},{data:member,error:memberError}]=await Promise.all([
      db.from('profiles').select('is_admin').eq('id',user.id).maybeSingle(),
      db.from('crm_team_members').select('email,role,is_active').eq('user_id',user.id).maybeSingle()
    ]);
    if(profileError)throw profileError;
    if(memberError)throw memberError;
    isAdmin=profile?.is_admin===true;
    actorTeam=isAdmin?'administrator':(member?.is_active===true&&String(member.email||'').toLowerCase()===String(user.email||'').toLowerCase()?String(member.role||''):'');
    if(!isAdmin&&!['customer_support','seller_support','sales','marketing'].includes(actorTeam))
      throw new Error('Active CRM team access is required.');
    if(payload?.action!=='snapshot'&&payload?.action!=='snapshot_email')
      throw new Error('This legacy action is disabled. Use the unified CRM inbox; no message was sent.');
    let query=db.from('crm_inbox_conversations')
      .select('id,provider,provider_thread_id,provider_message_id,department,contact_type,contact_name,contact_email,contact_phone,inbox_address,subject,latest_message,received_at,status,priority,assigned_to,metadata')
      .order('received_at',{ascending:false}).limit(100);
    if(payload.action==='snapshot')query=query.eq('provider','whatsapp');
    if(payload.action==='snapshot_email')query=query.eq('provider','email');
    const {data,error}=await query;
    if(error)throw error;
    const recent=(data||[]).map(c=>({
      id:Number(c.id),support_team:c.department==='sales'||c.department==='marketing'?'sales_marketing':c.department,
      routing_status:c.status||'open',sender_role:c.contact_type||'unknown',sender_phone:c.contact_phone||'',
      sender_email:c.contact_email||'',recipient_email:c.inbox_address||'',subject:c.subject||'',
      message_type:c.provider,message_text:c.latest_message||'',created_at:c.received_at,
      latest_reply_status:'Reply actions disabled',contact_name:c.contact_name||'',priority:c.priority||'normal'
    }));
    return {recent,actor_team:actorTeam,is_admin:isAdmin,generated_at:new Date().toISOString(),
      queues:{customer_support:recent.filter(r=>r.support_team==='customer_support').length,
      seller_support:recent.filter(r=>r.support_team==='seller_support').length,
      sales_marketing:recent.filter(r=>r.support_team==='sales_marketing').length,admin_operations:0,needs_review:0}};
  }
  async function load(){
    $('ffWaInboxStatus').textContent='Loading WhatsApp support inbox…';
    $('ffWaQueueReply').disabled=true;
    try{
      const data=await callApi({action:'snapshot'});
      rows=Array.isArray(data.recent)?data.recent:[];
      actorTeam=String(data.actor_team||'');isAdmin=data.is_admin===true;
      $('ffWaTeamAdmin').hidden=true;
      const filter=$('ffWaTeamFilter');
      [...filter.options].forEach(option=>{if(option.value==='all')option.textContent=isAdmin?'All queues':'My team queue';});
      [...filter.options].forEach(option=>{if(!['all','needs_review'].includes(option.value))option.hidden=!isAdmin&&option.value!==actorTeam&&!(actorTeam==='sales'||actorTeam==='marketing')});
      const q=data.queues||{};
      $('ffWaQueueCounts').innerHTML=[
        ['Customer support',q.customer_support],['Seller support',q.seller_support],
        ['Sales / marketing',q.sales_marketing],...(isAdmin?[['Admin operations',q.admin_operations]]:[]),
        ['Needs review',q.needs_review]
      ].map(([name,n])=>'<span><b>'+Number(n||0)+'</b>'+esc(name)+'</span>').join('');
      renderRows();renderEmails();
      $('ffWaInboxStatus').textContent='Refreshed '+date(data.generated_at)+'. Read-only inbox; no messages sent.';
    }catch(e){
      $('ffWaInboxRows').textContent='Inbox unavailable.';
      $('ffWaInboxStatus').textContent=e.message||'Inbox unavailable.';
    }
  }
  function renderRows(){
    const target=$('ffWaInboxRows');if(!target)return;
    const filter=$('ffWaTeamFilter').value;
    const filtered=rows.filter(r=>(isAdmin||r.support_team===actorTeam)&&(filter==='all'||(filter==='needs_review'?r.routing_status==='needs_review':r.support_team===filter)));
    if(!filtered.length){target.innerHTML='<p>No messages in this queue.</p>';return;}
    target.innerHTML=filtered.map(r=>'<button type="button" class="ff-wa-row" data-event="'+Number(r.id)+'" aria-pressed="false"><strong>'+esc(r.sender_role||'unknown')+' · '+esc(r.sender_phone||'')+'</strong><span class="ff-wa-pill">'+esc(r.support_team||'unassigned')+'</span> <span class="ff-wa-pill">'+esc(r.routing_status||'unknown')+'</span><div class="ff-wa-muted">'+esc(r.message_type||'message')+' · '+date(r.created_at)+'</div><div class="ff-wa-muted">'+esc(String(r.message_text||'[No text body]').slice(0,180))+'</div><div class="ff-wa-muted">Latest reply: '+esc(r.latest_reply_status||'none')+'</div></button>').join('');
    target.querySelectorAll('[data-event]').forEach(btn=>btn.addEventListener('click',()=>select(Number(btn.dataset.event),btn)));
  }
  function select(id,button){
    const row=rows.find(r=>Number(r.id)===id);if(!row)return;
    $('ffWaInboxRows').querySelectorAll('[data-event]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    $('ffWaSelectedTitle').textContent=(row.sender_role||'Unknown sender')+' · '+(row.sender_phone||'');
    $('ffWaSelectedMeta').textContent=(row.support_team||'unassigned')+' · '+(row.routing_status||'unknown')+' · '+date(row.created_at);
    $('ffWaSelectedMessage').textContent=row.message_text||'[No text body received]';
    $('ffWaIdentityReview').hidden=true;
    $('ffWaReplyText').value='';
    $('ffWaReplyCount').textContent='0 / 1000';
    $('ffWaQueueReply').dataset.eventId=String(id);
    $('ffWaQueueReply').disabled=true;
    $('ffWaApproveReply').hidden=true;
    $('ffWaApproveReply').disabled=!isAdmin||!row.latest_reply_id||row.latest_reply_status!=='pending_review';
    $('ffWaApproveReply').textContent=row.latest_reply_status==='ready'?'Reply approved': 'Approve latest reply';
    $('ffWaSendReply').hidden=true;
    $('ffWaSendReply').disabled=!isAdmin||row.latest_reply_status!=='ready';
    $('ffWaInboxStatus').textContent='Read-only inbox view. Classification and replies remain disabled until the provider workflow is verified.';
  }
  let emailRows=[],selectedEmailId=null;
  async function loadEmail(){
    $('ffEmailStatus').textContent='Loading Zoho Mail inbox…';
    try{
      const data=await callApi({action:'snapshot_email'});
      emailRows=Array.isArray(data.recent)?data.recent:[];
      const filter=$('ffEmailTeamFilter');
      [...filter.options].forEach(option=>{if(option.value==='all')option.textContent=data.is_admin?'All queues':'My team queue';});
      [...filter.options].forEach(option=>{if(option.value!=='all')option.hidden=!data.is_admin&&option.value!==data.actor_team&&!(data.actor_team==='sales'||data.actor_team==='marketing');});
      renderEmails();
      $('ffEmailStatus').textContent='Email inbox refreshed '+date(data.generated_at)+'. Read-only mode; no email sent.';
    }catch(e){$('ffEmailRows').textContent='Email inbox unavailable.';$('ffEmailStatus').textContent=e.message||'Email inbox unavailable.';}
  }
  function renderEmails(){
    const target=$('ffEmailRows');if(!target)return;
    const filter=$('ffEmailTeamFilter').value;
    const filtered=emailRows.filter(r=>(isAdmin||r.support_team===actorTeam)&&(filter==='all'||r.support_team===filter));
    if(!filtered.length){target.innerHTML='<p>No incoming email in this queue.</p>';return;}
    target.innerHTML=filtered.map(r=>'<button type="button" class="ff-wa-row" data-email-event="'+Number(r.id)+'" aria-pressed="'+(Number(r.id)===selectedEmailId)+'"><strong>'+esc(r.subject||'(No subject)')+'</strong><span class="ff-wa-pill">'+esc(r.support_team||'unassigned')+'</span> <span class="ff-wa-pill">'+esc(r.routing_status||'needs_review')+'</span><div class="ff-wa-muted">From: '+esc(r.sender_email||'')+'</div><div class="ff-wa-muted">To: '+esc(r.recipient_email||'')+' · '+date(r.received_at)+'</div><div class="ff-wa-muted">'+esc(String(r.message_text||'[No text body]').slice(0,180))+'</div></button>').join('');
    target.querySelectorAll('[data-email-event]').forEach(btn=>btn.addEventListener('click',()=>selectEmail(Number(btn.dataset.emailEvent))));
  }
  function selectEmail(id){
    const row=emailRows.find(r=>Number(r.id)===id);if(!row)return;selectedEmailId=id;
    $('ffEmailSelectedTitle').textContent=row.subject||'(No subject)';
    $('ffEmailSelectedMeta').textContent=(row.support_team||'unassigned')+' · '+(row.routing_status||'needs_review')+' · From '+(row.sender_email||'')+' · '+date(row.received_at);
    $('ffEmailSelectedMessage').textContent=row.message_text||'[No text body received]';
    $('ffEmailReplyText').value='';
    $('ffEmailClassify').disabled=row.routing_status==='classified';
    $('ffEmailQueueReply').disabled=row.routing_status!=='classified';
    $('ffEmailApproveReply').hidden=true;
    $('ffEmailApproveReply').disabled=!isAdmin||!row.latest_reply_id||row.latest_reply_status!=='pending_review';
    $('ffEmailApproveReply').textContent=row.latest_reply_status==='ready'?'Email reply approved':'Approve latest email reply';
    $('ffEmailSendReply').hidden=true;
    $('ffEmailSendReply').disabled=!isAdmin||row.latest_reply_status!=='ready';
    $('ffEmailStatus').textContent=row.routing_status==='classified'?'Email reviewed; replies can be staged for review.':'Review the sender/content, then confirm classification before drafting a reply.';
    renderEmails();
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
  async function classifyWhatsApp(){
    const id=Number($('ffWaQueueReply').dataset.eventId),senderRole=$('ffWaIdentityRole').value;
    if(!isAdmin||!Number.isSafeInteger(id)||id<=0)return;
    $('ffWaClassifyIdentity').disabled=true;$('ffWaInboxStatus').textContent='Saving sender identity review…';
    try{
      const result=await callApi({action:'classify_whatsapp',inboundEventId:id,senderRole});
      $('ffWaInboxStatus').textContent=result.message||'Identity review saved; no message sent.';
      $('ffWaIdentityReview').hidden=true;await load();
      const row=rows.find(r=>Number(r.id)===id);if(row)select(id,null);
    }catch(e){$('ffWaInboxStatus').textContent=e.message||'Identity review failed.';}
    finally{$('ffWaClassifyIdentity').disabled=false;}
  }
  async function approveWhatsAppReply(){
    const row=rows.find(r=>Number(r.id)===Number($('ffWaQueueReply').dataset.eventId));
    if(!isAdmin||!row?.latest_reply_id)return;
    $('ffWaApproveReply').disabled=true;$('ffWaInboxStatus').textContent='Approving reply for gated dispatch…';
    try{const result=await callApi({action:'approve_reply',replyId:Number(row.latest_reply_id)});$('ffWaInboxStatus').textContent=result.message||'Reply approved; no message sent.';await load();}
    catch(e){$('ffWaInboxStatus').textContent=e.message||'Reply approval failed.';$('ffWaApproveReply').disabled=false;}
  }
  async function sendWhatsAppReply(){
    const row=rows.find(r=>Number(r.id)===Number($('ffWaQueueReply').dataset.eventId));
    if(!isAdmin||!row?.latest_reply_id||row.latest_reply_status!=='ready')return;
    if(!confirm('Send this approved WhatsApp reply now? It will only proceed if all server-side launch gates are enabled.'))return;
    $('ffWaSendReply').disabled=true;$('ffWaInboxStatus').textContent='Checking gated WhatsApp dispatch…';
    try{
      const result=await callApi({action:'send_approved_reply',replyId:Number(row.latest_reply_id)});
      $('ffWaInboxStatus').textContent=result.message||result.error||'Dispatch request completed.';
      await load();
    }catch(e){$('ffWaInboxStatus').textContent=e.message||'WhatsApp dispatch failed.';$('ffWaSendReply').disabled=false;}
  }
  async function approveEmailReply(){
    const row=emailRows.find(r=>Number(r.id)===selectedEmailId);
    if(!isAdmin||!row?.latest_reply_id)return;
    $('ffEmailApproveReply').disabled=true;$('ffEmailStatus').textContent='Approving email reply for gated dispatch…';
    try{const result=await callApi({action:'approve_email_reply',replyId:Number(row.latest_reply_id)});$('ffEmailStatus').textContent=result.message||'Email reply approved; no email sent.';await loadEmail();if(selectedEmailId)selectEmail(selectedEmailId);}
    catch(e){$('ffEmailStatus').textContent=e.message||'Email reply approval failed.';$('ffEmailApproveReply').disabled=false;}
  }
  async function queueReply(){
    const id=Number($('ffWaQueueReply').dataset.eventId);
    const reply=$('ffWaReplyText').value.trim();
    if(!Number.isSafeInteger(id)||id<=0||!reply||reply.length>1000)return;
    $('ffWaQueueReply').disabled=true;
    $('ffWaInboxStatus').textContent='Queueing reply for review…';
    try{
      const key='crm-reply:'+id+':'+Date.now()+':'+Math.random().toString(36).slice(2,10);
      const data=await callApi({action:'queue_reply',inboundEventId:id,replyText:reply,requestKey:key});
      $('ffWaInboxStatus').textContent=data.message||'Reply queued for review. No message sent.';
      $('ffWaReplyText').value='';$('ffWaReplyCount').textContent='0 / 1000';
      await load();
    }catch(e){$('ffWaInboxStatus').textContent=e.message||'Reply could not be queued.';$('ffWaQueueReply').disabled=false;}
  }
  document.addEventListener('ff-crm-ready',mount);
  if(document.readyState!=='loading'&&$('dashboard')?.dataset.adminReady==='true')mount();
})();

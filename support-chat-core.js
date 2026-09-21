(function(){
'use strict';
if(!window.supabaseClient)return;
const supa=window.supabaseClient;
let currentTicket=null,channel=null;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
const closed=t=>['closed','resolved'].includes(String(t?.status||''));
async function user(){try{const{data:{session},error}=await supa.auth.getSession();if(!error&&session?.user)return session.user;const{data:{user:u}}=await supa.auth.getUser();return u||null}catch{return null}}
function setBusy(el,busy,label){if(!el)return;el.disabled=busy;if(label)el.textContent=label}
function statusLabel(v){return ({open:'Open',waiting_admin:'Waiting for Admin',waiting_seller:'Waiting for Seller',waiting_customer:'Waiting for you',closed:'Closed',reopened:'Reopened'})[v]||v||'Open'}
function shell(){
  if($('ffSupportLauncher'))return;
  const b=document.createElement('button');b.id='ffSupportLauncher';b.type='button';b.textContent='💬 Support Tickets';document.body.appendChild(b);
  const p=document.createElement('section');p.id='ffSupportPanel';p.setAttribute('aria-label','Customer Support Tickets');
  p.innerHTML='<div id="ffSupportHead"><span>Customer Support</span><button id="ffSupportClose" type="button" aria-label="Close">×</button></div><div id="ffSupportBody"></div><div class="ffInput" id="ffSupportInput" hidden><input id="ffSupportText" maxlength="5000" placeholder="Type your reply"><button id="ffSupportSend" type="button">Send</button></div>';
  document.body.appendChild(p);
  b.onclick=()=>{p.classList.toggle('open');if(p.classList.contains('open'))home()};
  $('ffSupportClose').onclick=()=>p.classList.remove('open');
  $('ffSupportSend').onclick=sendReply;
}
const body=()=>$('ffSupportBody'),input=()=>$('ffSupportInput');
async function home(){
  currentTicket=null;if(channel){supa.removeChannel(channel);channel=null}input().hidden=true;
  const u=await user();
  if(!u){body().innerHTML='<div class="ffReq"><b>Sign in required</b><p>Please sign in to create or view support tickets.</p><a class="ffBtn" href="login.html">Sign in</a></div>';return}
  body().innerHTML='<div class="ffReq"><b>Support Center</b><p>Most tickets are targeted for resolution within 2–3 working days.</p></div><div class="ffTicketActions"><button class="ffBtn" id="ffNewAdmin">New Customer Support ticket</button><button class="ffBtn ffSellerBtn" id="ffNewSeller">Product / Seller Support ticket</button></div><div id="ffTicketList"><p>Loading tickets…</p></div>';
  $('ffNewAdmin').onclick=()=>ticketForm('customer_support');$('ffNewSeller').onclick=()=>ticketForm('seller_support');
  const{data,error}=await supa.from('support_tickets').select('id,ticket_code,channel,order_id,product_id,issue_type,subject,status,priority,resolution_summary,sla_due_at,reopen_count,created_at,updated_at').order('updated_at',{ascending:false}).limit(50);
  const list=$('ffTicketList');if(!list)return;
  if(error){list.innerHTML='<div class="ffReq">'+esc(error.message)+'</div>';return}
  if(!data?.length){list.innerHTML='<div class="ffReq"><b>No tickets yet</b><p>Create a ticket whenever you need help.</p></div>';return}
  list.innerHTML=data.map(t=>'<button class="ffTicketCard" type="button" data-ticket="'+t.id+'"><span><b>'+esc(t.ticket_code)+'</b><small>'+esc(t.channel==='seller_support'?'Seller Support':'Customer Support')+' · '+esc(statusLabel(t.status))+'</small></span><span class="ffTicketSubject">'+esc(t.subject)+'</span><small>Updated '+esc(fmt(t.updated_at))+'</small></button>').join('');
  list.querySelectorAll('[data-ticket]').forEach(btn=>btn.onclick=()=>openTicket(Number(btn.dataset.ticket)));
}
async function loadOrders(){
  const{data,error}=await supa.from('orders').select('id,display_order_id,items,created_at').order('created_at',{ascending:false}).limit(50);if(error)throw error;return data||[];
}
async function ticketForm(kind){
  input().hidden=true;
  const u=await user();if(!u){location.href='login.html';return}
  if(kind==='customer_support'){
    let orders=[];try{orders=await loadOrders()}catch{}
    body().innerHTML='<div class="ffReq"><b>New Customer Support ticket</b><p>One issue = one Ticket ID. If the same issue returns after closure, reopen that same ticket.</p></div><div class="ffForm"><label>Issue type<select id="ffIssueType"><option value="order_help">Order help</option><option value="payment_help">Payment help</option><option value="delivery_help">Delivery / shipping</option><option value="return_refund">Return / refund</option><option value="account_help">Account help</option><option value="other">Other</option></select></label><label>Order (optional)<select id="ffOrder"><option value="">Not linked to an order</option>'+orders.map(o=>'<option value="'+o.id+'">'+esc(o.display_order_id||('Order #'+o.id))+'</option>').join('')+'</select></label><label>Subject<input id="ffSubject" maxlength="180" placeholder="Short summary" required></label><label>Describe the issue<textarea id="ffMessage" maxlength="5000" placeholder="Tell us what happened" required></textarea></label><button id="ffCreateTicket" type="button">Create ticket</button><button class="ffBack" id="ffBack" type="button">Back</button></div>';
    $('ffBack').onclick=home;$('ffCreateTicket').onclick=()=>createTicket('customer_support');return;
  }
  let orders=[];try{orders=await loadOrders()}catch(e){body().innerHTML='<div class="ffReq">'+esc(e.message)+'</div><button class="ffBtn" id="ffBack">Back</button>';$('ffBack').onclick=home;return}
  const lines=[];for(const o of orders){for(const item of Array.isArray(o.items)?o.items:[]){if(!item?.id)continue;lines.push({orderId:o.id,display:o.display_order_id||('Order #'+o.id),productId:item.id,variantId:item.variant_id||null,name:item.name||('Product #'+item.id),variant:item.variant_title||[item.size,item.color].filter(Boolean).join(' / ')})}}
  if(!lines.length){body().innerHTML='<div class="ffReq"><b>No purchased product found</b><p>Seller Support tickets can only be raised for products in your orders.</p></div><button class="ffBtn" id="ffBack">Back</button>';$('ffBack').onclick=home;return}
  body().innerHTML='<div class="ffReq"><b>New Product / Seller Support ticket</b><p>This conversation is visible to you, the linked Seller, and Admin. One issue = one Ticket ID.</p></div><div class="ffForm"><label>Purchased product<select id="ffPurchasedItem">'+lines.map((x,i)=>'<option value="'+i+'">'+esc(x.display+' — '+x.name+(x.variant?' ('+x.variant+')':''))+'</option>').join('')+'</select></label><label>Issue type<select id="ffIssueType"><option value="product_issue">Product issue</option><option value="damaged_item">Damaged item</option><option value="wrong_item">Wrong item</option><option value="missing_item">Missing item / part</option><option value="quality_issue">Quality issue</option><option value="other">Other</option></select></label><label>Subject<input id="ffSubject" maxlength="180" placeholder="Short summary" required></label><label>Describe the issue<textarea id="ffMessage" maxlength="5000" placeholder="Describe the product issue" required></textarea></label><button id="ffCreateTicket" type="button">Create Seller Support ticket</button><button class="ffBack" id="ffBack" type="button">Back</button></div>';
  $('ffBack').onclick=home;$('ffCreateTicket').onclick=()=>createTicket('seller_support',lines);
}
async function createTicket(kind,lines=[]){
  const btn=$('ffCreateTicket'),subject=$('ffSubject')?.value.trim(),message=$('ffMessage')?.value.trim(),issue=$('ffIssueType')?.value||'other';
  if(!subject||subject.length<3||!message){alert('Subject and issue description are required.');return}
  let orderId=null,productId=null,variantId=null;
  if(kind==='customer_support'){orderId=Number($('ffOrder')?.value)||null}else{const item=lines[Number($('ffPurchasedItem')?.value||0)];if(!item){alert('Select a purchased product.');return}orderId=item.orderId;productId=item.productId;variantId=item.variantId}
  setBusy(btn,true,'Creating…');
  try{const{data,error}=await supa.rpc('create_support_ticket',{p_channel:kind,p_order_id:orderId,p_product_id:productId,p_variant_id:variantId,p_issue_type:issue,p_subject:subject,p_message:message});if(error)throw error;const ticket=Array.isArray(data)?data[0]:data;if(!ticket?.id)throw new Error('Ticket was created but could not be opened.');await openTicket(ticket.id)}catch(e){alert(e.message||'Could not create ticket.')}finally{setBusy(btn,false,kind==='seller_support'?'Create Seller Support ticket':'Create ticket')}
}
async function openTicket(id){
  input().hidden=true;const{data:t,error}=await supa.from('support_tickets').select('*').eq('id',id).maybeSingle();if(error||!t){body().innerHTML='<div class="ffReq">Ticket not found.</div>';return}currentTicket=t;
  const{data:messages,error:me}=await supa.from('support_ticket_messages').select('id,sender_role,message,source,created_at').eq('ticket_id',id).order('created_at');
  if(me){body().innerHTML='<div class="ffReq">'+esc(me.message)+'</div>';return}
  body().innerHTML='<div class="ffTicketHead"><button class="ffMini" id="ffBack" type="button">← Tickets</button><div><b>'+esc(t.ticket_code)+'</b><small>'+esc(t.channel==='seller_support'?'Seller Support':'Customer Support')+' · '+esc(statusLabel(t.status))+'</small></div></div><div class="ffReq"><b>'+esc(t.subject)+'</b><p>Opened '+esc(fmt(t.created_at))+'</p>'+(t.sla_due_at?'<p>Target resolution: '+esc(fmt(t.sla_due_at))+'</p>':'')+(t.resolution_summary?'<p><b>Resolution:</b> '+esc(t.resolution_summary)+'</p>':'')+'</div><div id="ffMessages">'+(messages||[]).map(m=>'<div class="ffMsg '+(m.sender_role==='customer'?'ffCustomer':'ffAdmin')+'"><small>'+esc(m.sender_role==='seller'?'Seller':m.sender_role==='admin'?'Admin':m.sender_role==='customer_care'?'Customer Care':m.sender_role==='system'?'System':'You')+' · '+esc(fmt(m.created_at))+'</small>'+esc(m.message)+'</div>').join('')+'</div>'+(closed(t)?'<button class="ffBtn" id="ffReopen" type="button">Reopen same ticket</button>':'');
  $('ffBack').onclick=home;
  if(closed(t)){$('ffReopen').onclick=reopenTicket;input().hidden=true}else input().hidden=false;
  subscribe(id);
}
async function sendReply(){const field=$('ffSupportText'),msg=field?.value.trim();if(!currentTicket||!msg)return;const btn=$('ffSupportSend');setBusy(btn,true,'Sending…');try{const{error}=await supa.rpc('send_support_ticket_message',{p_ticket_id:currentTicket.id,p_message:msg});if(error)throw error;field.value='';await openTicket(currentTicket.id)}catch(e){alert(e.message||'Could not send reply.')}finally{setBusy(btn,false,'Send')}}
async function reopenTicket(){const msg=prompt('Why are you reopening this same issue?');if(!msg?.trim())return;try{const{data,error}=await supa.rpc('reopen_support_ticket',{p_ticket_id:currentTicket.id,p_message:msg.trim()});if(error)throw error;const ticket=Array.isArray(data)?data[0]:data;if(!ticket?.id)throw new Error('Ticket could not be reopened.');await openTicket(ticket.id)}catch(e){alert(e.message||'Could not reopen ticket.')}}
function subscribe(id){if(channel)supa.removeChannel(channel);channel=supa.channel('customer-ticket-'+id).on('postgres_changes',{event:'*',schema:'public',table:'support_ticket_messages',filter:'ticket_id=eq.'+id},()=>openTicket(id)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'support_tickets',filter:'id=eq.'+id},()=>openTicket(id)).subscribe()}
function init(){shell()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

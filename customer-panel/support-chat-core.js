(function(){
'use strict';
if(!window.supabaseClient)return;
const supa=window.supabaseClient;
const CUSTOMER_CARE_EMAIL='customer.care@fashionfussion.in';
let currentTicket=null,channel=null;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
const closed=t=>['closed','resolved'].includes(String(t?.status||''));
async function user(){try{const{data:{session},error}=await supa.auth.getSession();if(!error&&session?.user)return session.user;const{data:{user:u}}=await supa.auth.getUser();return u||null}catch{return null}}
function setBusy(el,busy,label){if(!el)return;el.disabled=busy;if(label)el.textContent=label}
function statusLabel(v){return ({open:'Bot assisting',waiting_admin:'Waiting for live agent',waiting_seller:'Waiting for Seller',waiting_customer:'Waiting for you',closed:'Closed',reopened:'Reopened'})[v]||v||'Open'}
function typeLabel(t){return t?.channel==='seller_support'?'Seller Support':'Customer Support'}
function senderLabel(role){return role==='seller'?'Seller':role==='admin'?'Admin':role==='customer_care'?'Live agent':role==='bot'?'Support Bot':role==='system'?'System':'You'}
function customerCareMarkup(signedIn=false){return '<div class="ffReq"><b>Customer & product support</b><p>'+(signedIn?'Start a Customer Support chat for product, order, payment, delivery, return/refund or account help. The Support Bot replies first and you can switch to a live agent anytime.':'Email Customer Care, or sign in to start a support chat and request a live agent when needed.')+'</p><a class="ffBtn ffMailBtn" href="mailto:'+CUSTOMER_CARE_EMAIL+'?subject=Fashion_Fussion%20Customer%20Support">Email '+CUSTOMER_CARE_EMAIL+'</a></div>'}
function shell(){
  if($('ffSupportLauncher'))return;
  const b=document.createElement('button');b.id='ffSupportLauncher';b.type='button';b.textContent='💬 Support';document.body.appendChild(b);
  const p=document.createElement('section');p.id='ffSupportPanel';p.setAttribute('aria-label','Customer Support');
  p.innerHTML='<div id="ffSupportHead"><span>Customer Support</span><button id="ffSupportClose" type="button" aria-label="Close">×</button></div><div id="ffSupportBody"></div><div class="ffInput" id="ffSupportInput" hidden><input id="ffSupportText" maxlength="5000" placeholder="Type your reply or say live agent"><button id="ffSupportSend" type="button">Send</button></div>';
  document.body.appendChild(p);
  b.onclick=()=>{p.classList.toggle('open');if(p.classList.contains('open'))home()};
  $('ffSupportClose').onclick=()=>p.classList.remove('open');
  $('ffSupportSend').onclick=sendReply;
}
const body=()=>$('ffSupportBody'),input=()=>$('ffSupportInput');
async function home(){
  currentTicket=null;if(channel){supa.removeChannel(channel);channel=null}input().hidden=true;
  const u=await user();
  if(!u){body().innerHTML=customerCareMarkup(false)+'<div class="ffTicketActions"><a class="ffBtn" href="login.html?redirect=account">Sign in to start support chat</a></div><div class="ffReq"><b>Issue related to a seller?</b><p>Sign in and raise a Seller Support ticket so the issue can be linked to the correct seller.</p></div>';return}
  body().innerHTML=customerCareMarkup(true)+'<div class="ffTicketActions"><button class="ffBtn" id="ffNewCustomer">Start Customer Support chat</button></div><div class="ffReq"><b>Issue related to a seller?</b><p>Use Seller Support only when your concern is specifically about the seller. Product, order, payment, delivery, return/refund and account issues should use Customer Support.</p></div><div class="ffTicketActions"><button class="ffBtn ffSellerBtn" id="ffNewSeller">Raise Seller Support ticket</button></div><div id="ffTicketList"><p>Loading previous tickets…</p></div>';
  $('ffNewCustomer').onclick=customerTicketForm;$('ffNewSeller').onclick=sellerTicketForm;
  const{data,error}=await supa.from('support_tickets').select('id,ticket_code,channel,order_id,product_id,issue_type,subject,status,priority,support_mode,handoff_requested_at,live_agent_joined_at,resolution_summary,sla_due_at,reopen_count,created_at,updated_at').order('updated_at',{ascending:false}).limit(50);
  const list=$('ffTicketList');if(!list)return;if(error){list.innerHTML='<div class="ffReq">'+esc(error.message)+'</div>';return}
  if(!data?.length){list.innerHTML='<div class="ffReq"><b>No support chats yet</b><p>Start Customer Support for normal customer-service issues, or Seller Support for a seller-specific concern.</p></div>';return}
  list.innerHTML=data.map(t=>'<button class="ffTicketCard" type="button" data-ticket="'+t.id+'"><span><b>'+esc(t.ticket_code)+'</b><small>'+esc(typeLabel(t))+' · '+esc(statusLabel(t.status))+'</small></span><span class="ffTicketSubject">'+esc(t.subject)+'</span><small>Updated '+esc(fmt(t.updated_at))+'</small></button>').join('');
  list.querySelectorAll('[data-ticket]').forEach(btn=>btn.onclick=()=>openTicket(Number(btn.dataset.ticket)));
}
async function loadOrders(){const{data,error}=await supa.from('orders').select('id,display_order_id,items,created_at').order('created_at',{ascending:false}).limit(50);if(error)throw error;return data||[]}
async function customerTicketForm(){
  input().hidden=true;const u=await user();if(!u){location.href='login.html?redirect=account';return}
  let orders=[];try{orders=await loadOrders()}catch{}
  const orderOptions=['<option value="">General issue / not linked to an order</option>'].concat(orders.map(o=>'<option value="'+o.id+'">'+esc(o.display_order_id||('Order #'+o.id))+' — '+esc(fmt(o.created_at))+'</option>')).join('');
  body().innerHTML='<div class="ffReq ffBotIntro"><b>Start Customer Support chat</b><p>The Support Bot will reply instantly using your ticket/order context when available. If it cannot help, or if you ask for a person, the same chat is automatically transferred to a live Customer Care agent.</p></div><div class="ffForm"><label>Issue type<select id="ffCustomerIssue"><option value="product">Product issue</option><option value="order">Order issue</option><option value="payment">Payment issue</option><option value="delivery">Delivery issue</option><option value="return_refund">Return / refund</option><option value="account">Account issue</option><option value="other">Other customer issue</option></select></label><label>Related order (optional)<select id="ffCustomerOrder">'+orderOptions+'</select></label><label>Subject<input id="ffCustomerSubject" maxlength="180" placeholder="Short summary of the issue" required></label><label>Describe the issue<textarea id="ffCustomerMessage" maxlength="5000" placeholder="Explain what happened and what help you need" required></textarea></label><button id="ffCreateCustomerTicket" type="button">Start support chat</button><a class="ffBtn ffMailBtn" href="mailto:'+CUSTOMER_CARE_EMAIL+'?subject=Fashion_Fussion%20Customer%20Support">Email Customer Care instead</a><button class="ffBack" id="ffBack" type="button">Back</button></div>';
  $('ffBack').onclick=home;$('ffCreateCustomerTicket').onclick=createCustomerTicket;
}
async function createCustomerTicket(){
  const btn=$('ffCreateCustomerTicket'),issue=$('ffCustomerIssue')?.value||'other',subject=$('ffCustomerSubject')?.value.trim(),message=$('ffCustomerMessage')?.value.trim(),orderRaw=$('ffCustomerOrder')?.value||'';
  if(!subject||subject.length<3||!message){alert('Subject and issue description are required.');return}
  const orderId=orderRaw?Number(orderRaw):null;setBusy(btn,true,'Starting…');
  try{const{data,error}=await supa.rpc('create_support_ticket',{p_channel:'customer_support',p_order_id:orderId,p_product_id:null,p_variant_id:null,p_issue_type:issue,p_subject:subject,p_message:message});if(error)throw error;const ticket=Array.isArray(data)?data[0]:data;if(!ticket?.id)throw new Error('Support chat was created but could not be opened.');await openTicket(ticket.id)}catch(e){alert(e.message||'Could not start Customer Support chat.')}finally{setBusy(btn,false,'Start support chat')}
}
async function sellerTicketForm(){
  input().hidden=true;const u=await user();if(!u){location.href='login.html?redirect=account';return}
  let orders=[];try{orders=await loadOrders()}catch(e){body().innerHTML='<div class="ffReq">'+esc(e.message)+'</div><button class="ffBtn" id="ffBack">Back</button>';$('ffBack').onclick=home;return}
  const lines=[];for(const o of orders){for(const item of Array.isArray(o.items)?o.items:[]){if(!item?.id)continue;lines.push({orderId:o.id,display:o.display_order_id||('Order #'+o.id),productId:item.id,variantId:item.variant_id||null,name:item.name||('Product #'+item.id),variant:item.variant_title||[item.size,item.color].filter(Boolean).join(' / ')})}}
  if(!lines.length){body().innerHTML=customerCareMarkup(true)+'<div class="ffReq"><b>No purchased item found to identify a seller</b><p>A Seller Support ticket must be linked to a purchased item so it reaches the correct seller. Use Customer Support for normal product or order help.</p></div><button class="ffBtn" id="ffCustomerInstead">Start Customer Support chat</button><button class="ffBtn ffBack" id="ffBack">Back</button>';$('ffCustomerInstead').onclick=customerTicketForm;$('ffBack').onclick=home;return}
  body().innerHTML='<div class="ffReq"><b>Raise Seller Support ticket</b><p>Use this only for a concern specifically about the seller. For normal customer-service help, use Customer Support.</p></div><div class="ffForm"><label>Purchase linked to seller<select id="ffPurchasedItem">'+lines.map((x,i)=>'<option value="'+i+'">'+esc(x.display+' — '+x.name+(x.variant?' ('+x.variant+')':''))+'</option>').join('')+'</select></label><label>Seller issue summary<input id="ffSubject" maxlength="180" placeholder="Short summary of the seller-related issue" required></label><label>Describe the seller-related issue<textarea id="ffMessage" maxlength="5000" placeholder="Explain what happened with the seller" required></textarea></label><button id="ffCreateTicket" type="button">Raise Seller Support ticket</button><button class="ffBack" id="ffBack" type="button">Back</button></div>';
  $('ffBack').onclick=home;$('ffCreateTicket').onclick=()=>createSellerTicket(lines);
}
async function createSellerTicket(lines=[]){
  const btn=$('ffCreateTicket'),subject=$('ffSubject')?.value.trim(),message=$('ffMessage')?.value.trim();if(!subject||subject.length<3||!message){alert('Subject and issue description are required.');return}
  const item=lines[Number($('ffPurchasedItem')?.value||0)];if(!item){alert('Select a purchased item.');return}setBusy(btn,true,'Creating…');
  try{const{data,error}=await supa.rpc('create_support_ticket',{p_channel:'seller_support',p_order_id:item.orderId,p_product_id:item.productId,p_variant_id:item.variantId,p_issue_type:'other',p_subject:subject,p_message:message});if(error)throw error;const ticket=Array.isArray(data)?data[0]:data;if(!ticket?.id)throw new Error('Ticket was created but could not be opened.');await openTicket(ticket.id)}catch(e){alert(e.message||'Could not create Seller Support ticket.')}finally{setBusy(btn,false,'Raise Seller Support ticket')}
}
async function openTicket(id){
  input().hidden=true;const{data:t,error}=await supa.from('support_tickets').select('*').eq('id',id).maybeSingle();if(error||!t){body().innerHTML='<div class="ffReq">Ticket not found.</div>';return}currentTicket=t;
  const{data:messages,error:me}=await supa.from('support_ticket_messages').select('id,sender_role,message,source,created_at').eq('ticket_id',id).order('created_at');if(me){body().innerHTML='<div class="ffReq">'+esc(me.message)+'</div>';return}
  const isCustomer=t.channel==='customer_support';
  const modeNote=isCustomer?'<div class="ffMode '+(t.support_mode==='human'?'human':'bot')+'"><b>'+(t.support_mode==='human'?'Live agent mode':'Support Bot active')+'</b><span>'+(t.support_mode==='human'?(t.live_agent_joined_at?'A live agent has joined this chat.':'Your chat is in the Customer Care queue. You can keep sending messages here.'):'Automatic help is active. Type “live agent” or use the button below whenever you want a person.')+'</span></div>':'';
  const agentAction=isCustomer&&!closed(t)&&t.support_mode!=='human'?'<button class="ffBtn ffAgentBtn" id="ffLiveAgent" type="button">Talk to live agent</button>':'';
  const emailAction=isCustomer?'<a class="ffBtn ffMailBtn" href="mailto:'+CUSTOMER_CARE_EMAIL+'?subject='+encodeURIComponent('Fashion_Fussion Support '+(t.ticket_code||''))+'">Email Customer Care if required</a>':'';
  body().innerHTML='<div class="ffTicketHead"><button class="ffMini" id="ffBack" type="button">← Support</button><div><b>'+esc(t.ticket_code)+'</b><small>'+esc(typeLabel(t))+' · '+esc(statusLabel(t.status))+'</small></div></div>'+modeNote+'<div class="ffReq"><b>'+esc(t.subject)+'</b><p>Opened '+esc(fmt(t.created_at))+'</p>'+(t.sla_due_at?'<p>Target resolution: '+esc(fmt(t.sla_due_at))+'</p>':'')+(t.resolution_summary?'<p><b>Resolution:</b> '+esc(t.resolution_summary)+'</p>':'')+'</div><div id="ffMessages">'+(messages||[]).map(m=>'<div class="ffMsg '+(m.sender_role==='customer'?'ffCustomer':m.sender_role==='bot'?'ffBot':'ffAdmin')+'"><small>'+esc(senderLabel(m.sender_role))+' · '+esc(fmt(m.created_at))+'</small>'+esc(m.message)+'</div>').join('')+'</div>'+agentAction+emailAction+(closed(t)?'<button class="ffBtn" id="ffReopen" type="button">Reopen same ticket</button>':'');
  $('ffBack').onclick=home;if($('ffLiveAgent'))$('ffLiveAgent').onclick=requestLiveAgent;
  if(closed(t)){$('ffReopen').onclick=reopenTicket;input().hidden=true}else input().hidden=false;subscribe(id);
}
async function requestLiveAgent(){if(!currentTicket)return;const btn=$('ffLiveAgent');setBusy(btn,true,'Transferring…');try{const{data,error}=await supa.rpc('request_live_support_agent',{p_ticket_id:currentTicket.id});if(error)throw error;const ticket=Array.isArray(data)?data[0]:data;if(ticket?.id)await openTicket(ticket.id);else await openTicket(currentTicket.id)}catch(e){alert(e.message||'Could not transfer to a live agent.')}finally{setBusy(btn,false,'Talk to live agent')}}
async function sendReply(){const field=$('ffSupportText'),msg=field?.value.trim();if(!currentTicket||!msg)return;const btn=$('ffSupportSend');setBusy(btn,true,'Sending…');try{const{error}=await supa.rpc('send_support_ticket_message',{p_ticket_id:currentTicket.id,p_message:msg});if(error)throw error;field.value='';await openTicket(currentTicket.id)}catch(e){alert(e.message||'Could not send reply.')}finally{setBusy(btn,false,'Send')}}
async function reopenTicket(){const msg=prompt('Why are you reopening this same issue?');if(!msg?.trim())return;try{const{data,error}=await supa.rpc('reopen_support_ticket',{p_ticket_id:currentTicket.id,p_message:msg.trim()});if(error)throw error;const ticket=Array.isArray(data)?data[0]:data;if(!ticket?.id)throw new Error('Ticket could not be reopened.');await openTicket(ticket.id)}catch(e){alert(e.message||'Could not reopen ticket.')}}
function subscribe(id){if(channel)supa.removeChannel(channel);channel=supa.channel('customer-ticket-'+id).on('postgres_changes',{event:'*',schema:'public',table:'support_ticket_messages',filter:'ticket_id=eq.'+id},()=>openTicket(id)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'support_tickets',filter:'id=eq.'+id},()=>openTicket(id)).subscribe()}
function init(){shell()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

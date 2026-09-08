(function(){
  'use strict';
  if (!window.supabaseClient) return;
  const supa = window.supabaseClient;
  const page = location.pathname.split('/').pop() || 'index.html';
  const isAdminPage = page === 'admin.html';
  const isCustomerPage = ['index.html','account.html'].includes(page);
  if (!isAdminPage && !isCustomerPage) return;

  const css = `
  #ffSupportLauncher{position:fixed;right:18px;bottom:18px;z-index:9998;border:0;border-radius:999px;padding:13px 18px;background:#2874f0;color:#fff;font-weight:700;box-shadow:0 4px 18px rgba(0,0,0,.22)}
  #ffSupportPanel{position:fixed;right:18px;bottom:72px;width:360px;max-width:calc(100vw - 36px);height:520px;max-height:70vh;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 35px rgba(0,0,0,.25);display:none;overflow:hidden}
  #ffSupportPanel.open{display:flex;flex-direction:column}#ffSupportHead{padding:13px 15px;background:#2874f0;color:#fff;display:flex;justify-content:space-between;align-items:center;font-weight:700}#ffSupportClose{background:transparent;border:0;color:#fff;font-size:22px}
  #ffSupportBody{padding:14px;overflow:auto;flex:1}.ffMsg{padding:9px 11px;border-radius:10px;margin:7px 0;max-width:85%;font-size:13px;white-space:pre-wrap}.ffCustomer{margin-left:auto;background:#e3f2fd}.ffAdmin{background:#f1f1f1}.ffReq{padding:10px;border:1px solid #ddd;border-radius:8px;margin:8px 0}.ffReq button{margin:5px 5px 0 0;padding:7px 10px;border:0;border-radius:5px;background:#2874f0;color:#fff}.ffInput{display:flex;gap:7px;padding:10px;border-top:1px solid #eee}.ffInput input{flex:1;padding:9px;border:1px solid #bbb;border-radius:6px}.ffInput button{border:0;border-radius:6px;background:#2874f0;color:#fff;padding:9px 12px}.ffForm input,.ffForm textarea{width:100%;margin:5px 0;padding:9px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box}.ffForm textarea{min-height:75px}.ffForm button{width:100%;margin-top:6px;padding:9px;border:0;border-radius:6px;background:#2874f0;color:#fff;font-weight:700}
  `;
  const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  function shell(){
    const b=document.createElement('button');b.id='ffSupportLauncher';b.textContent=isAdminPage?'🔔 Support':'💬 Customer Care';document.body.appendChild(b);
    const p=document.createElement('div');p.id='ffSupportPanel';p.innerHTML='<div id="ffSupportHead"><span>Customer Care</span><button id="ffSupportClose">×</button></div><div id="ffSupportBody"></div><div class="ffInput" id="ffSupportInput" style="display:none"><input id="ffSupportText" placeholder="Type your message"><button id="ffSupportSend">Send</button></div>';document.body.appendChild(p);
    b.onclick=()=>{p.classList.toggle('open'); if(p.classList.contains('open')) isAdminPage?loadAdmin():loadCustomer();};document.getElementById('ffSupportClose').onclick=()=>p.classList.remove('open');
  }
  const body=()=>document.getElementById('ffSupportBody');
  const input=()=>document.getElementById('ffSupportInput');
  async function user(){return (await supa.auth.getUser()).data.user;}

  async function loadCustomer(){
    const u=await user();
    if(!u){body().innerHTML='<p>Please login first to contact customer care.</p><a href="login.html">Login</a>';input().style.display='none';return;}
    const {data:req}=await supa.from('customer_support_requests').select('*').eq('user_id',u.id).in('status',['pending','accepted']).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(req){showCustomerChat(req);return;}
    body().innerHTML='<div class="ffForm"><p><b>Connect me to an Agent</b></p><input id="ffName" placeholder="Your name"><input id="ffPhone" placeholder="Mobile number"><textarea id="ffIssue" placeholder="Describe your issue"></textarea><button id="ffCreate">Send request to agent</button></div>';
    const {data:prof}=await supa.from('profiles').select('full_name,phone').eq('id',u.id).maybeSingle();if(prof){document.getElementById('ffName').value=prof.full_name||'';document.getElementById('ffPhone').value=prof.phone||'';}
    document.getElementById('ffCreate').onclick=async()=>{const name=document.getElementById('ffName').value.trim(),phone=document.getElementById('ffPhone').value.trim(),issue=document.getElementById('ffIssue').value.trim();if(!name||!phone||!issue){alert('Name, mobile and issue are required.');return;}const {data,error}=await supa.from('customer_support_requests').insert({user_id:u.id,customer_name:name,customer_phone:phone,customer_email:u.email||null,issue}).select().single();if(error){alert(error.message);return;}showCustomerChat(data);};
  }
  function showCustomerChat(req){
    body().innerHTML='<div class="ffReq"><b>Request #'+req.id+'</b><br>Status: '+req.status+'<br><small>'+escapeHtml(req.issue)+'</small></div><div id="ffMessages"></div>';input().style.display=req.status==='accepted'?'flex':'none';loadMessages(req.id);subscribe(req.id,'customer');
  }
  async function loadMessages(id){const {data}=await supa.from('customer_support_messages').select('*').eq('request_id',id).order('created_at');const box=document.getElementById('ffMessages');if(!box)return;box.innerHTML=(data||[]).map(m=>'<div class="ffMsg '+(m.sender_type==='customer'?'ffCustomer':'ffAdmin')+'">'+escapeHtml(m.message)+'</div>').join('');box.scrollTop=box.scrollHeight;}
  function subscribe(id,type){if(window.__ffSupportChannel){supa.removeChannel(window.__ffSupportChannel);}window.__ffSupportChannel=supa.channel('support-'+id+'-'+type).on('postgres_changes',{event:'*',schema:'public',table:'customer_support_messages',filter:'request_id=eq.'+id},()=>loadMessages(id)).subscribe();}
  function escapeHtml(v){return String(v||'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  document.addEventListener('click',async e=>{if(e.target.id!=='ffSupportSend')return;const t=document.getElementById('ffSupportText'),msg=t.value.trim();if(!msg)return;const u=await user();const {data:req}=await supa.from('customer_support_requests').select('id,status').eq('user_id',u.id).eq('status','accepted').order('created_at',{ascending:false}).limit(1).maybeSingle();if(!req){alert('Chat is not accepted yet.');return;}const {error}=await supa.from('customer_support_messages').insert({request_id:req.id,sender_type:'customer',sender_user_id:u.id,message:msg});if(error)alert(error.message);else t.value='';});

  async function loadAdmin(){
    const u=await user();if(!u){body().innerHTML='Please login.';return;}const {data:p}=await supa.from('profiles').select('is_admin').eq('id',u.id).maybeSingle();if(!p?.is_admin){body().innerHTML='Access denied.';return;}
    const {data:reqs,error}=await supa.from('customer_support_requests').select('*').in('status',['pending','accepted']).order('created_at',{ascending:false});if(error){body().innerHTML=escapeHtml(error.message);return;}
    body().innerHTML=(reqs||[]).map(r=>'<div class="ffReq"><b>'+escapeHtml(r.customer_name)+'</b> · '+escapeHtml(r.customer_phone)+'<br><small>'+escapeHtml(r.issue)+'</small><br><small>Status: '+r.status+'</small><br>'+ (r.status==='pending'?'<button data-accept="'+r.id+'">Accept Chat</button>':'<button data-chat="'+r.id+'">Open Chat</button>')+' <a href="tel:'+encodeURIComponent(r.customer_phone)+'"><button>Call</button></a></div>').join('')||'<p>No active support requests.</p>';
    document.querySelectorAll('[data-accept]').forEach(x=>x.onclick=()=>accept(x.dataset.accept));document.querySelectorAll('[data-chat]').forEach(x=>x.onclick=()=>adminChat(x.dataset.chat));
    subscribeAdmin();
  }
  async function accept(id){const u=await user();const {error}=await supa.from('customer_support_requests').update({status:'accepted',assigned_admin_id:u.id,updated_at:new Date().toISOString()}).eq('id',id).eq('status','pending');if(error)alert(error.message);else adminChat(id);}
  async function adminChat(id){body().innerHTML='<div class="ffReq"><b>Live customer chat #'+id+'</b></div><div id="ffMessages"></div>';input().style.display='flex';loadMessagesAdmin(id);if(window.__ffSupportChannel)supa.removeChannel(window.__ffSupportChannel);window.__ffSupportChannel=supa.channel('support-admin-'+id).on('postgres_changes',{event:'*',schema:'public',table:'customer_support_messages',filter:'request_id=eq.'+id},()=>loadMessagesAdmin(id)).subscribe();document.getElementById('ffSupportSend').onclick=async()=>{const t=document.getElementById('ffSupportText'),msg=t.value.trim();if(!msg)return;const u=await user();const {error}=await supa.from('customer_support_messages').insert({request_id:Number(id),sender_type:'admin',sender_user_id:u.id,message:msg});if(error)alert(error.message);else t.value='';};}
  async function loadMessagesAdmin(id){const {data}=await supa.from('customer_support_messages').select('*').eq('request_id',id).order('created_at');const box=document.getElementById('ffMessages');if(!box)return;box.innerHTML=(data||[]).map(m=>'<div class="ffMsg '+(m.sender_type==='admin'?'ffCustomer':'ffAdmin')+'">'+escapeHtml(m.message)+'</div>').join('');}
  function subscribeAdmin(){if(window.__ffSupportAdmin){supa.removeChannel(window.__ffSupportAdmin);}window.__ffSupportAdmin=supa.channel('support-admin-requests').on('postgres_changes',{event:'*',schema:'public',table:'customer_support_requests'},()=>{if(document.getElementById('ffSupportPanel')?.classList.contains('open'))loadAdmin();}).subscribe();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',shell);else shell();
})();

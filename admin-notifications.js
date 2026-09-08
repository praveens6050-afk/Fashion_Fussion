(function(){
'use strict';
if(!window.supabaseClient)return;

function text(tag,value,className){
  const el=document.createElement(tag);
  if(className)el.className=className;
  el.textContent=String(value??'');
  return el;
}

async function init(){
  if((location.pathname.split('/').pop()||'')!=='admin.html')return;
  const{data:{user}}=await window.supabaseClient.auth.getUser();
  if(!user)return;
  const{data:p}=await window.supabaseClient.from('profiles').select('is_admin').eq('id',user.id).maybeSingle();
  if(!p?.is_admin)return;

  const host=document.querySelector('.header-actions');
  if(!host)return;

  const a=document.createElement('a');
  a.href='#';
  a.id='ffAdminNotifications';
  a.textContent='🔔 Notifications';
  a.style.position='relative';
  host.insertBefore(a,host.firstChild);

  const panel=document.createElement('div');
  panel.style.cssText='display:none;position:fixed;right:20px;top:75px;width:360px;max-width:calc(100vw - 40px);max-height:65vh;overflow:auto;background:#fff;color:#222;border:1px solid #ddd;border-radius:8px;box-shadow:0 8px 30px #0003;z-index:10000;padding:14px';
  document.body.appendChild(panel);

  async function load(){
    const{data,error}=await window.supabaseClient.from('customer_support_requests').select('id,customer_name,customer_phone,issue,status,created_at').order('created_at',{ascending:false}).limit(30);
    if(error){panel.replaceChildren(text('p','Unable to load notifications.'));return}

    const rows=data||[];
    const pending=rows.filter(x=>x.status==='pending');
    a.textContent='🔔 Notifications'+(pending.length?' ('+pending.length+')':'');
    panel.replaceChildren();
    const heading=text('h3','Customer Requests');
    heading.style.marginTop='0';
    panel.appendChild(heading);

    if(!rows.length){panel.appendChild(text('p','No customer requests.'));return}

    rows.forEach(r=>{
      const item=document.createElement('div');
      item.style.cssText='border-top:1px solid #eee;padding:10px 0';
      const name=text('b',r.customer_name||'Customer');
      const issue=text('div',r.issue||'');
      issue.style.fontSize='12px';
      issue.style.marginTop='4px';
      const status=text('small','Status: '+String(r.status||'pending'));
      item.append(name,issue,status);
      panel.appendChild(item);
    });
  }

  a.onclick=e=>{
    e.preventDefault();
    panel.style.display=panel.style.display==='none'?'block':'none';
    if(panel.style.display==='block')load();
  };

  await load();
  window.supabaseClient.channel('admin-notifications').on('postgres_changes',{event:'*',schema:'public',table:'customer_support_requests'},load).subscribe();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
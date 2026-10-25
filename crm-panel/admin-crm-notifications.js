'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>v?new Date(v).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
  let snapshot=null;
  function mount(){
    const container=$('dashboard')?.querySelector('.container');if(!container||$('ffCrmNotifications'))return;
    const section=document.createElement('section');section.id='ffCrmNotifications';section.className='card';
    section.innerHTML='<div class="card-header"><div><h2>Notification delivery monitor</h2><p>Email, WhatsApp and payment-recovery status. Read-only; this panel never sends or retries messages.</p></div><button type="button" class="secondary" id="ffCrmNotifyRefresh">Refresh status</button></div><div class="card-body"><div class="ff-crm-notify-stats" id="ffCrmNotifyStats"></div><div class="ff-crm-notify-grid"><section><h3>Zoho order emails</h3><div id="ffCrmEmailRows">Loading…</div></section><section><h3>WhatsApp order notifications</h3><div id="ffCrmWhatsAppRows">Loading…</div></section><section><h3>Payment recovery notices</h3><div id="ffCrmRecoveryRows">Loading…</div></section></div><p id="ffCrmNotifyMessage" role="status" aria-live="polite"></p></div>';
    const style=document.createElement('style');style.textContent='#ffCrmNotifications{margin-top:20px}#ffCrmNotifications .ff-crm-notify-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}#ffCrmNotifications .ff-crm-notify-stats span{padding:10px 12px;border-radius:8px;background:#f2f4f7;font-size:12px}#ffCrmNotifications .ff-crm-notify-stats b{display:block;font-size:18px}#ffCrmNotifications .ff-crm-notify-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}#ffCrmNotifications .ff-crm-notify-grid section{min-width:0;overflow:auto}#ffCrmNotifications table{width:100%;min-width:330px;border-collapse:collapse;font-size:12px}#ffCrmNotifications th,#ffCrmNotifications td{padding:8px;border-bottom:1px solid #eaecf0;text-align:left;vertical-align:top}#ffCrmNotifications th{background:#f8fafc}#ffCrmNotifications .muted{color:#667085;font-size:11px}#ffCrmNotifications .pill{display:inline-block;border-radius:999px;padding:3px 7px;background:#f2f4f7}#ffCrmNotifications .pill.failed,#ffCrmNotifications .pill.blocked{background:#fee4e2;color:#912018}#ffCrmNotifications .pill.sent,#ffCrmNotifications .pill.delivered,#ffCrmNotifications .pill.read{background:#dcfae6;color:#05603a}@media(max-width:900px){#ffCrmNotifications .ff-crm-notify-grid{grid-template-columns:1fr}}';document.head.appendChild(style);container.appendChild(section);$('ffCrmNotifyRefresh').onclick=load;load();
  }
  async function load(){
    $('ffCrmNotifyMessage').textContent='Loading notification status…';
    try{
      const db=window.supabaseClient;if(!db?.auth)throw new Error('CRM session is unavailable.');
      const {data:{session},error}=await db.auth.getSession();if(error||!session?.access_token)throw new Error('Please sign in again.');
      const response=await fetch('/api/admin-crm-notifications',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw new Error(result.error||'Notification status could not be loaded.');
      snapshot=result.data||{};render();$('ffCrmNotifyMessage').textContent='Last refreshed '+date(snapshot.generated_at)+'. Read-only view; no messages were sent or retried.';
    }catch(e){$('ffCrmNotifyMessage').textContent=e.message||'Notification monitor unavailable.';for(const id of ['ffCrmEmailRows','ffCrmWhatsAppRows','ffCrmRecoveryRows'])$(id).textContent='Status unavailable.'}
  }
  function countBox(label,c){c=c||{};return '<span><b>'+Number(c.total||0)+'</b>'+esc(label)+' total · '+Number(c.sent||0)+' sent · '+Number(c.pending||0)+' pending · '+Number(c.failed||0)+' failed</span>'}
  function table(rows,channel){
    if(!rows?.length)return '<p>No notification records found.</p>';
    return '<table><thead><tr><th>Order / event</th><th>Status</th><th>Attempts / time</th></tr></thead><tbody>'+rows.slice(0,12).map(r=>{
      const status=String(r.status||r.last_provider_status||'unknown').toLowerCase();
      const error=channel==='recovery'?Boolean(r.has_error):Boolean(r.last_error_code);
      return '<tr><td><b>#'+esc(r.order_id??'—')+'</b><div class="muted">'+esc(r.event_type||r.template_name||'notification')+'</div>'+(error?'<div class="muted">Provider error recorded</div>':'')+'</td><td><span class="pill '+esc(status)+'">'+esc(status)+'</span>'+(r.last_provider_status&&r.last_provider_status!==status?'<div class="muted">Provider: '+esc(r.last_provider_status)+'</div>':'')+'</td><td>'+Number(r.attempt_count||0)+' attempts<div class="muted">'+date(r.sent_at||r.provider_delivered_at||r.last_attempt_at||r.created_at)+'</div></td></tr>'
    }).join('')+'</tbody></table>';
  }
  function render(){
    const email=snapshot.email||{},wa=snapshot.whatsapp||{},recovery=snapshot.payment_recovery||{};
    $('ffCrmNotifyStats').innerHTML=countBox('Zoho email',email.counts)+countBox('WhatsApp',wa.counts)+countBox('Payment recovery',recovery.counts);
    $('ffCrmEmailRows').innerHTML=table(email.recent,'email');
    $('ffCrmWhatsAppRows').innerHTML=table(wa.recent,'whatsapp');
    $('ffCrmRecoveryRows').innerHTML=table(recovery.recent,'recovery');
  }
  function init(){const d=$('dashboard');if(!d)return;if(d.dataset.adminReady==='true'){mount();return}const o=new MutationObserver(()=>{if(d.dataset.adminReady==='true'){o.disconnect();mount()}});o.observe(d,{attributes:true,attributeFilter:['data-admin-ready']})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

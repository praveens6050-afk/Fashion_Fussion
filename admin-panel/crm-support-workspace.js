'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
  function notice(message,ok=false){const el=$('crmSupportNotice');if(el){el.textContent=message;el.style.color=ok?'#067647':'#b42318'}}
  function sla(due){if(!due)return 'Not set';const ms=new Date(due).getTime()-Date.now();if(ms<0)return 'OVERDUE';if(ms<3600000)return 'DUE SOON';return Math.ceil(ms/3600000)+'h left'}
  async function load(){
    const db=await ready;
    if(!db?.auth)throw new Error('CRM authentication service unavailable');
    const{data:{session},error:sessionError}=await db.auth.getSession();
    if(sessionError||!session?.user)throw new Error('Please sign in again');
    const{data:member,error:memberError}=await db.from('crm_team_members').select('role,is_active,email').eq('user_id',session.user.id).maybeSingle();
    if(memberError||!member||member.is_active!==true||String(member.email||'').toLowerCase()!==String(session.user.email||'').toLowerCase()||!['customer_support','seller_support'].includes(member.role))throw new Error('Support department access could not be verified');
    const{data,error}=await db.rpc('crm_support_ticket_queue');
    if(error)throw error;
    const rows=$('crmSupportRows');
    if(!Array.isArray(data)||data.length===0){rows.innerHTML='<tr><td colspan="6">No tickets in your department queue.</td></tr>';notice('Queue loaded. No tickets found.',true);return}
    rows.innerHTML=data.map(t=>'<tr><td><strong>'+esc(t.ticket_code||('Ticket #'+t.id))+'</strong></td><td>'+esc(t.subject||t.issue_type||'Support request')+'</td><td>'+esc(t.status)+'</td><td>'+esc(t.priority)+'</td><td>'+esc(t.created_at?new Date(t.created_at).toLocaleString():'—')+'</td></tr>').join('');
    notice('Loaded '+data.length+' ticket(s). Read-only access.',true);
  }
  load().catch(error=>{const rows=$('crmSupportRows');if(rows)rows.innerHTML='<tr><td colspan="6">Support queue unavailable.</td></tr>';notice(error.message||'Unable to load support queue')});
})();

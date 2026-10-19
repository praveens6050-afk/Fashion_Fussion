'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
  const labels={customer_support:'Customer Support',seller_support:'Seller Support',sales:'Sales',marketing:'Marketing'};
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function notice(message,ok=false){const el=$('crmTeamNotice');if(el){el.textContent=message;el.style.color=ok?'#067647':'#b42318'}}
  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
  async function client(){const db=await ready;if(!db?.auth)throw new Error('CRM authentication service unavailable');const{data:{session}}=await db.auth.getSession();if(!session?.user)throw new Error('Please sign in again');const{data:profile,error}=await db.from('profiles').select('is_admin').eq('id',session.user.id).maybeSingle();if(error||profile?.is_admin!==true)throw new Error('Only verified CRM administrators can manage team access');return{db,user:session.user}}
  async function load(){
    const{db}=await client();
    const{data,error}=await db.from('crm_team_members').select('user_id,email,role,is_active,created_at').order('created_at',{ascending:false});
    if(error)throw error;
    const rows=$('crmTeamRows');
    if(!data?.length){rows.innerHTML='<tr><td colspan="4">No CRM team members added yet.</td></tr>';return}
    rows.innerHTML=data.map(m=>'<tr><td><strong>'+esc(m.email)+'</strong><br><small>'+esc(m.user_id)+'</small></td><td>'+esc(labels[m.role]||m.role)+'</td><td><span class="crm-team-status '+(m.is_active?'active':'inactive')+'">'+(m.is_active?'Active':'Inactive')+'</span></td><td>'+(m.is_active?'<button type="button" data-deactivate="'+esc(m.user_id)+'">Deactivate</button>':'<button type="button" data-reactivate="'+esc(m.user_id)+'">Reactivate</button>')+'</td></tr>').join('');
    rows.querySelectorAll('[data-deactivate],[data-reactivate]').forEach(button=>button.addEventListener('click',async()=>{
      const id=button.dataset.deactivate||button.dataset.reactivate;
      const nextActive=Boolean(button.dataset.reactivate);
      if(!confirm((nextActive?'Reactivate':'Deactivate')+' CRM access for this team member?'))return;
      button.disabled=true;
      try{const{db}=await client();const{error}=await db.from('crm_team_members').update({is_active:nextActive,updated_at:new Date().toISOString()}).eq('user_id',id);if(error)throw error;notice('Team access '+(nextActive?'reactivated':'deactivated')+'.',true);await load()}catch(error){notice(error.message||'Could not update team access')}finally{button.disabled=false}
    }));
  }
  $('crmTeamForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const email=$('crmMemberEmail').value.trim().toLowerCase(),userId=$('crmMemberId').value.trim(),role=$('crmMemberRole').value,button=$('crmMemberSave');
    if(!uuid.test(userId)){notice('Enter a valid Supabase Auth user UUID.');return}
    if(!Object.hasOwn(labels,role)){notice('Choose a valid department.');return}
    button.disabled=true;button.textContent='Saving…';
    try{
      const{db}=await client();
      const{data,error}=await db.from('crm_team_members').upsert({user_id:userId,email,role,is_active:true,updated_at:new Date().toISOString()},{onConflict:'user_id'}).select('user_id,email,role,is_active').single();
      if(error)throw error;
      if(!data||data.user_id!==userId||data.email!==email||data.role!==role||data.is_active!==true)throw new Error('Saved member details could not be verified');
      $('crmTeamForm').reset();notice('Team member access saved. They can sign in with their own invited Auth account.',true);await load();
    }catch(error){notice(error.message||'Could not save team member')}
    finally{button.disabled=false;button.textContent='Add / Update Team Member'}
  });
  load().catch(error=>notice(error.message||'Unable to load team roster'));
})();

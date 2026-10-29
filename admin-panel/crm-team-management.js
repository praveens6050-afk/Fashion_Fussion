'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const ready=window.ffAdminSupabaseReady||Promise.resolve(window.supabaseClient);
  const labels={customer_support:'Customer Support',seller_support:'Seller Support',sales:'Sales',marketing:'Marketing',orders:'Orders'};
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function notice(message,ok=false){const el=$('crmTeamNotice');if(el){el.textContent=message;el.style.color=ok?'#067647':'#b42318'}}
  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
  async function client(){const db=await ready;if(!db?.auth)throw new Error('CRM authentication service unavailable');const{data:{session}}=await db.auth.getSession();if(!session?.user)throw new Error('Please sign in again');const{data:profile,error}=await db.from('profiles').select('is_admin').eq('id',session.user.id).maybeSingle();if(error||profile?.is_admin!==true)throw new Error('Only verified CRM administrators can manage team access');return{db,user:session.user}}
  const zohoNotice=$('crmZohoNotice');
  function showZohoNotice(message,ok=false){if(zohoNotice){zohoNotice.textContent=message;zohoNotice.style.color=ok?'#067647':'#b42318'}}
  const zohoParams=new URLSearchParams(window.location.search);
  const returnedMailbox=zohoParams.get('zoho_mailbox')||'';
  if(zohoParams.get('zoho_oauth')==='connected')showZohoNotice('Connected '+returnedMailbox+'. CRM department aliases will use this mailbox. No email was sent.',true);
  else if(zohoParams.get('zoho_oauth')==='denied')showZohoNotice('Connection was not completed for '+returnedMailbox+'.');
  $('crmZohoConnect')?.addEventListener('click',async()=>{
    const button=$('crmZohoConnect');button.disabled=true;button.textContent='Opening Zoho…';
    try{
      const db=await ready;if(!db?.auth)throw new Error('CRM authentication service unavailable');
      const{data:{session}}=await db.auth.getSession();if(!session?.user)throw new Error('Please sign in again');
      const mailboxAddress='admin@fashionfussion.in';const{data,error}=await db.functions.invoke('crm-zoho-oauth-start',{body:{mailbox_address:mailboxAddress}});
      if(error||!data?.authorization_url)throw new Error(data?.error||'Could not start Zoho authorization');
      window.location.assign(data.authorization_url);
    }catch(error){showZohoNotice(error.message||'Could not start Zoho authorization');button.disabled=false;button.textContent='Connect admin mailbox'}
  });
  async function load(){
    const{db}=await client();
    const{data,error}=await db.from('crm_team_members').select('user_id,email,role,is_active,created_at').order('created_at',{ascending:false});
    if(error)throw error;
    const members=data||[],rows=$('crmTeamRows');
    rows.innerHTML=members.length?members.map(m=>'<tr><td><strong>'+esc(m.email)+'</strong><br><small>'+esc(m.user_id)+'</small></td><td>'+esc(labels[m.role]||m.role)+'</td><td><span class="crm-team-status '+(m.is_active?'active':'inactive')+'">'+(m.is_active?'Active':'Inactive')+'</span></td><td>'+(m.is_active?'<button type="button" data-deactivate="'+esc(m.user_id)+'">Deactivate</button>':'<button type="button" data-reactivate="'+esc(m.user_id)+'">Reactivate</button>')+'</td></tr>').join(''):'<tr><td colspan="4">No CRM team members added yet.</td></tr>';
    rows.querySelectorAll('[data-deactivate],[data-reactivate]').forEach(button=>button.addEventListener('click',async()=>{
      const id=button.dataset.deactivate||button.dataset.reactivate,nextActive=Boolean(button.dataset.reactivate);
      if(!confirm((nextActive?'Reactivate':'Deactivate')+' CRM access for this team member?'))return;
      button.disabled=true;
      try{const{db}=await client();const{error}=await db.from('crm_team_members').update({is_active:nextActive,updated_at:new Date().toISOString()}).eq('user_id',id);if(error)throw error;notice('Team access '+(nextActive?'reactivated':'deactivated')+'.',true);await load()}catch(error){notice(error.message||'Could not update team access')}finally{button.disabled=false}
    }));
    mountQuotaTools(db,members);
  }
  function mountQuotaTools(db,members){
    const body=$('crmTeamManagement')?.querySelector('.card-body');if(!body)return;
    const sales=members.filter(m=>m.role==='sales'&&m.is_active);
    if($('crmQuotaTools')){const select=$('crmQuotaUser');if(select)select.innerHTML=sales.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.email)+'</option>').join('');const save=$('crmQuotaForm')?.querySelector('button[type="submit"]');if(save)save.disabled=!sales.length;return;}
    const section=document.createElement('section');section.id='crmQuotaTools';section.innerHTML='<h3>Sales Quotas</h3><p>Set monthly or custom-period revenue targets for active Sales team members.</p><form id="crmQuotaForm" class="crm-team-form"><label for="crmQuotaUser">Sales representative</label><select id="crmQuotaUser" required>'+sales.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.email)+'</option>').join('')+'</select><label for="crmQuotaStart">Period start</label><input id="crmQuotaStart" type="date" required><label for="crmQuotaEnd">Period end</label><input id="crmQuotaEnd" type="date" required><label for="crmQuotaTarget">Revenue target (INR)</label><input id="crmQuotaTarget" type="number" min="0" step="0.01" required><button class="primary" type="submit" '+(!sales.length?'disabled':'')+'>Save quota</button></form><div id="crmQuotaNotice" role="status"></div><div id="crmQuotaRows"></div>';
    body.appendChild(section);
    const qnotice=message=>{const el=$('crmQuotaNotice');if(el)el.textContent=message};
    async function refresh(){
      const{data,error}=await db.from('crm_sales_quotas').select('user_id,period_start,period_end,revenue_target').order('period_start',{ascending:false});
      if(error)throw error;
      $('crmQuotaRows').innerHTML=(data||[]).map(q=>'<p>'+esc(members.find(m=>m.user_id===q.user_id)?.email||q.user_id)+' · '+esc(q.period_start)+' to '+esc(q.period_end)+' · '+esc(q.revenue_target)+' INR</p>').join('')||'<p>No quotas configured yet.</p>';
    }
    $('crmQuotaForm').addEventListener('submit',async event=>{
      event.preventDefault();
      const userId=$('crmQuotaUser').value,start=$('crmQuotaStart').value,end=$('crmQuotaEnd').value,target=Number($('crmQuotaTarget').value);
      if(!userId||!start||!end||end<start||!Number.isFinite(target)||target<0){qnotice('Check the Sales member, dates and target amount.');return}
      try{const{error}=await db.from('crm_sales_quotas').upsert({user_id:userId,period_start:start,period_end:end,revenue_target:target},{onConflict:'user_id,period_start,period_end'});if(error)throw error;qnotice('Sales quota saved.');await refresh()}catch(error){qnotice(error.message||'Could not save quota')}
    });
    refresh().catch(error=>qnotice(error.message||'Quota list unavailable'));
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


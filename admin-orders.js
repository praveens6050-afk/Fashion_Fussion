(function(){
  const STATUSES=['ordered','packed','shipped','out_for_delivery','delivered','cancelled'];
  const LABELS={ordered:'Ordered',packed:'Packed',shipped:'Shipped',out_for_delivery:'Out for Delivery',delivered:'Delivered',cancelled:'Cancelled'};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const money=v=>'₹'+Number(v||0).toLocaleString('en-IN');
  const date=v=>v?new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';

  function inject(){
    if($('ffOrdersCard')) return;
    const dashboard=document.querySelector('#dashboard .container'); if(!dashboard) return;
    const card=document.createElement('section'); card.className='card'; card.id='ffOrdersCard';
    card.innerHTML=`<div class="card-header"><h2>Order Management</h2><button class="secondary" id="ffRefreshOrders" type="button">↻ Refresh</button></div><div class="card-body"><div id="ffOrderStatus"></div><div class="table-wrapper"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>AMOUNT</th><th>PAYMENT</th><th>FULFILLMENT</th><th>UPDATED</th></tr></thead><tbody id="ffOrdersTable"><tr><td colspan="6" style="text-align:center;padding:30px">Loading orders...</td></tr></tbody></table></div></div>`;
    dashboard.appendChild(card);
    $('ffRefreshOrders').addEventListener('click',load);
    $('ffOrdersTable').addEventListener('change',async e=>{if(e.target.matches('.ff-order-status')) await update(e.target);});
    load();
  }

  async function load(){
    const tbody=$('ffOrdersTable'); if(!tbody||!window.supabaseClient) return;
    tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:30px">Loading orders...</td></tr>';
    const {data,error}=await window.supabaseClient.from('orders').select('id,customer_name,customer_email,customer_phone,total_amount,currency,status,fulfillment_status,fulfillment_updated_at,created_at').order('created_at',{ascending:false}).limit(100);
    if(error){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:30px;color:#c62828">'+esc(error.message)+'</td></tr>';return;}
    if(!data?.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:30px">No orders yet.</td></tr>';return;}
    tbody.innerHTML=data.map(o=>`<tr><td><strong>#${esc(o.id)}</strong><div style="font-size:11px;color:#777;margin-top:4px">${esc(date(o.created_at))}</div></td><td>${esc(o.customer_name||'Customer')}<div style="font-size:11px;color:#777;margin-top:4px">${esc(o.customer_email||o.customer_phone||'')}</div></td><td>${o.currency==='INR'||!o.currency?money(o.total_amount):esc(o.currency)+' '+esc(o.total_amount)}</td><td>${esc(o.status||'—')}</td><td><select class="ff-order-status" data-id="${esc(o.id)}" data-old="${esc(o.fulfillment_status||'ordered')}">${STATUSES.map(s=>`<option value="${s}" ${s===(o.fulfillment_status||'ordered')?'selected':''}>${LABELS[s]}</option>`).join('')}</select></td><td>${esc(date(o.fulfillment_updated_at))}</td></tr>`).join('');
  }

  async function update(select){
    const id=select.dataset.id, old=select.dataset.old, value=select.value;
    select.disabled=true;
    const {error}=await window.supabaseClient.from('orders').update({fulfillment_status:value,fulfillment_updated_at:new Date().toISOString()}).eq('id',id);
    select.disabled=false;
    if(error){select.value=old; alert('Could not update order: '+error.message); return;}
    select.dataset.old=value; await load();
  }

  const observer=new MutationObserver(()=>{if(document.getElementById('dashboard')?.style.display!=='none') inject();});
  observer.observe(document.documentElement,{attributes:true,childList:true,subtree:true});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',inject); else inject();
})();
(function(){'use strict';
if(window.__ffSellerLiveOperations)return;window.__ffSellerLiveOperations=true;
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
const fmt=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})};
const status=v=>String(v||'').replaceAll('_',' ')||'—';
let client=null,busy=false,lastOperations={orders:[],returns:[],summary:{}};
function toast(m){window.SellerCatalogBridge?.notify?.(m)}
function setCopy(){
 const orders=$('view-orders'),payments=$('view-payments'),returns=$('view-returns');
 orders?.querySelector('.page-head p:last-child')&&(orders.querySelector('.page-head p:last-child').textContent='Live seller-owned orders from the production order ledger.');
 const notice=orders?.querySelector('.notice.info');if(notice)notice.innerHTML='<div class="notice-icon">i</div><div><strong>Live order data</strong><p>Only order lines linked to your approved products are shown. Payment and fulfilment status come from the authoritative order record.</p></div>';
 orders?.querySelectorAll('.metric-card small').forEach(x=>x.textContent='Live data');
 payments?.querySelector('.page-head p:last-child')&&(payments.querySelector('.page-head p:last-child').textContent='Settlement records from your verified seller finance profile.');
 payments?.querySelector('.panel-head p')&&(payments.querySelector('.panel-head p').textContent='Authoritative settlement ledger.');
 returns?.querySelector('.page-head p:last-child')&&(returns.querySelector('.page-head p:last-child').textContent='Return and exchange requests linked to your seller-owned order items.');
 returns?.querySelectorAll('.metric-card small').forEach(x=>x.textContent='Live data');
 returns?.querySelector('.panel-head p')&&(returns.querySelector('.panel-head p').textContent='Authoritative post-purchase requests.');
}
function renderOrders(data,query=''){const all=data.orders||[],s=data.summary||{},q=String(query||'').trim().toLowerCase();
 const orders=q?all.filter(o=>[o.display_order_id,o.id,o.customer_name,o.status,o.fulfillment_status].some(v=>String(v||'').toLowerCase().includes(q))):all;
 $('orderMetricTotal')&&($('orderMetricTotal').textContent=Number(s.order_count||all.length));
 $('orderMetricNew')&&($('orderMetricNew').textContent=all.filter(o=>['pending','confirmed','processing'].includes(String(o.status||'').toLowerCase())).length);
 $('orderMetricProcessing')&&($('orderMetricProcessing').textContent=all.filter(o=>['processing','packed','shipped'].includes(String(o.fulfillment_status||'').toLowerCase())).length);
 $('orderMetricRevenue')&&($('orderMetricRevenue').textContent=money(s.gross_sales||0));
 const host=$('ordersList');if(!host)return;
 if(q&&!orders.length){host.innerHTML='<div class="empty-state"><h3>No matching orders</h3><p>Try another order ID, customer name or status.</p></div>';return}
 host.innerHTML=orders.length?orders.map(o=>`<article class="data-row"><div><strong>${esc(o.display_order_id||('Order #'+o.id))}</strong><span>${esc(o.customer_name||'Customer')} · ${esc(fmt(o.created_at))}</span></div><div><strong>${esc(money(o.seller_total))}</strong><span>${esc(status(o.status))} · ${esc(status(o.fulfillment_status))}</span></div></article>`).join(''):'<div class="empty-state"><h3>No seller orders yet</h3><p>Orders containing your approved products will appear here.</p></div>';
}
function renderReturns(data){const rows=data.returns||[];const open=rows.filter(r=>!['completed','rejected','cancelled','closed'].includes(String(r.status||'').toLowerCase()));
 $('returnOpen')&&($('returnOpen').textContent=open.length);$('returnClosed')&&($('returnClosed').textContent=rows.length-open.length);
 const cards=[...document.querySelectorAll('#view-returns .metric-card strong')];if(cards[2])cards[2].textContent=rows.filter(r=>String(r.request_type||'').toLowerCase()==='exchange').length;if(cards[3])cards[3].textContent=(data.summary?.order_count?((rows.length/Number(data.summary.order_count))*100).toFixed(1)+'%':'—');
 const host=$('returnsList');if(!host)return;host.innerHTML=rows.length?rows.map(r=>`<article class="data-row"><div><strong>${esc(status(r.request_type))}</strong><span>Order #${esc(r.order_id)} · ${esc(r.item?.name||'Item')} · Qty ${esc(r.quantity||1)}</span></div><div><strong>${esc(status(r.status))}</strong><span>${r.refund_amount!=null?esc(money(r.refund_amount))+' · ':''}${esc(fmt(r.created_at))}</span></div></article>`).join(''):'<div class="empty-state"><h3>No return requests</h3><p>Return or exchange requests for your sold items will appear here.</p></div>';
}
function renderPayments(finance){const rows=finance.settlements||[],paid=rows.filter(r=>String(r.status||'').toLowerCase()==='paid'),pending=rows.filter(r=>!['paid','failed','cancelled'].includes(String(r.status||'').toLowerCase()));
 $('paymentPaid')&&($('paymentPaid').textContent=money(paid.reduce((a,r)=>a+Number(r.net_amount||0),0)));$('paymentPending')&&($('paymentPending').textContent=money(pending.reduce((a,r)=>a+Number(r.net_amount||0),0)));
 const cards=[...document.querySelectorAll('#view-payments .metric-card strong')];if(cards[2])cards[2].textContent=rows.length?'Recorded':'—';if(cards[3])cards[3].textContent=finance.payout?.account_number_last4?'•••• '+finance.payout.account_number_last4:'Not linked';
 const smalls=[...document.querySelectorAll('#view-payments .metric-card small')];if(smalls[2])smalls[2].textContent='Settlement ledger';if(smalls[3])smalls[3].textContent='Payout: '+status(finance.payout?.verification_status||'not started');
 const host=$('paymentsList');if(!host)return;host.innerHTML=rows.length?rows.map(r=>`<article class="data-row"><div><strong>${esc(fmt(r.period_start).split(',')[0])} – ${esc(fmt(r.period_end).split(',')[0])}</strong><span>Gross ${esc(money(r.gross_amount))} · Deductions ${esc(money(Number(r.fees_amount||0)+Number(r.refunds_amount||0)))}</span></div><div><strong>${esc(money(r.net_amount))}</strong><span>${esc(status(r.status))}${r.paid_at?' · '+esc(fmt(r.paid_at)):''}</span></div></article>`).join(''):'<div class="empty-state"><h3>No settlement records yet</h3><p>Admin-created settlement records will appear here after eligible sales.</p></div>';
}
function renderUnavailable(){
 ['orderMetricTotal','orderMetricNew','orderMetricProcessing','orderMetricRevenue','paymentPaid','paymentPending','returnOpen','returnClosed'].forEach(id=>{$(id)&&($(id).textContent='—')});
 const returnCards=[...document.querySelectorAll('#view-returns .metric-card strong')];if(returnCards[2])returnCards[2].textContent='—';if(returnCards[3])returnCards[3].textContent='—';
 const paymentCards=[...document.querySelectorAll('#view-payments .metric-card strong')];if(paymentCards[2])paymentCards[2].textContent='—';if(paymentCards[3])paymentCards[3].textContent='Unavailable';
 [['ordersList','Orders are temporarily unavailable.'],['paymentsList','Settlement data is temporarily unavailable.'],['returnsList','Return data is temporarily unavailable.']].forEach(([id,msg])=>{const host=$(id);if(host)host.innerHTML=`<div class="empty-state"><h3>Could not load live data</h3><p>${esc(msg)} Please refresh and try again.</p></div>`});
}
function bindOrderSearch(){const input=$('orderSearch');if(!input||input.dataset.liveBound==='1')return;input.dataset.liveBound='1';input.addEventListener('input',()=>renderOrders(lastOperations,input.value))}
async function load(){if(busy)return;busy=true;try{const [{data:ops,error:oe},{data:finance,error:fe}]=await Promise.all([client.rpc('get_seller_operations'),client.rpc('get_seller_finance_profile')]);if(oe)throw oe;if(fe)throw fe;lastOperations=ops||{orders:[],returns:[],summary:{}};renderOrders(lastOperations,$('orderSearch')?.value||'');renderReturns(lastOperations);renderPayments(finance||{});setCopy()}catch(e){renderUnavailable();toast(e.message||'Could not load seller operations.')}finally{busy=false}}
async function init(){client=await(window.ffSellerSupabaseReady||window.ffSupabaseReady||Promise.resolve(window.supabaseClient));if(!client){renderUnavailable();return}setCopy();bindOrderSearch();await load();document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});else init().catch(console.error);
})();

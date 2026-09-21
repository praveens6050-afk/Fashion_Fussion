(function(){'use strict';
const BACKEND_URL=window.FF_API_ORIGIN||'';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
function badge(state,label){const key=state==='ready'?'ready':state==='waiting'?'waiting':'blocked',text=key==='ready'?'Ready':key==='waiting'?'Waiting':'Blocked';return '<span data-csp-style="csp-dyn-'+key+'">'+text+'</span>'+(label?' <span data-csp-style="csp-js-admin-launch-readiness-1">· '+esc(label)+'</span>':'')}
async function session(){const{data:{session},error}=await window.supabaseClient.auth.getSession();if(error||!session?.access_token)throw new Error('Admin session expired');return session}
async function api(token,action,payload={}){const r=await fetch(BACKEND_URL+'/api/admin-order-action',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({action,...payload})}),d=await r.json().catch(()=>({}));return r.ok?d:{ok:false,error:d.error||('Request failed ('+r.status+')')}}
async function q(builder,label){const{data,error}=await builder;if(error)throw new Error(label+': '+error.message);return data||[]}
async function snapshot(){const s=await session(),client=window.supabaseClient;
  const [checkout,shiprocket,shipping,products,variants,inventory,orders]=await Promise.all([
    api(s.access_token,'checkout_health'),
    api(s.access_token,'connection_test'),
    api(s.access_token,'admin_list'),
    q(client.from('products').select('id,is_active'),'Products'),
    q(client.from('product_variants').select('id,product_id,is_active'),'Variants'),
    q(client.from('inventory_levels').select('variant_id,on_hand,reserved'),'Inventory'),
    q(client.from('orders').select('id,status,payment_method,fulfillment_status').order('id',{ascending:false}).limit(500),'Orders')
  ]);
  const activeProducts=new Set(products.filter(x=>x.is_active).map(x=>Number(x.id))),stock=new Map(inventory.map(x=>[Number(x.variant_id),Math.max(0,Number(x.on_hand||0)-Number(x.reserved||0))]));
  const sellable=variants.filter(v=>v.is_active&&activeProducts.has(Number(v.product_id))&&(stock.get(Number(v.id))||0)>0),availableUnits=sellable.reduce((sum,v)=>sum+(stock.get(Number(v.id))||0),0);
  const packedEligible=orders.filter(o=>String(o.fulfillment_status||'').toLowerCase()==='packed'&&((String(o.payment_method||'').toLowerCase()==='prepaid'&&String(o.status||'').toLowerCase()==='paid')||(String(o.payment_method||'').toLowerCase()==='cod'&&['cod_pending','cod_collected'].includes(String(o.status||'').toLowerCase()))));
  const shipments=Array.isArray(shipping.shipments)?shipping.shipments:[],awb=shipments.filter(x=>x.awb_code).length,pickup=shipments.filter(x=>x.pickup_requested_at).length;
  const catalogReady=sellable.length>0,shiprocketReady=Boolean(shiprocket.authenticated&&shiprocket.serviceability_ready),codReady=Boolean(checkout.cod_test_ready&&catalogReady),prepaidReady=Boolean(checkout.prepaid_test_ready&&catalogReady);
  let next='First live-order path is ready for another controlled verification.';
  if(!catalogReady)next='Add a real product as Inactive, create an active SKU, set available stock above 0, then activate the product.';
  else if(!checkout.test_account?.delivery_address_ready)next='Save a real delivery address on the current test account before checkout.';
  else if(!codReady)next='Resolve the Checkout Readiness blockers before placing the controlled COD order.';
  else if(!shiprocketReady)next='Resolve Shiprocket connection/pickup readiness before fulfillment testing.';
  else if(packedEligible.length<1)next='Place one controlled real order, verify payment/COD state, then mark it Packed in Admin Orders.';
  else if(shipments.length<1)next='Use the packed real order in Shipping: Check couriers first, then Create shipment.';
  else if(awb<1)next='Assign an AWB to the created real shipment.';
  else if(pickup<1)next='Request pickup for the AWB-assigned shipment.';
  else next='Pickup stage has been reached. Sync tracking and verify the customer tracking view.';
  return{checkout,shiprocket,shipping,catalog:{ready:catalogReady,active_products:activeProducts.size,sellable_skus:sellable.length,available_units:availableUnits},orders:{total:orders.length,packed_eligible:packedEligible.length},shipments:{total:shipments.length,awb,pickup},codReady,prepaidReady,shiprocketReady,next};
}
function inject(){if($('ffLaunchReadinessCard'))return;const root=document.querySelector('#dashboard .container');if(!root)return;const card=document.createElement('section');card.className='card';card.id='ffLaunchReadinessCard';card.innerHTML='<div class="card-header"><div><h2>First Live Order Readiness</h2><div data-csp-style="csp-js-admin-launch-readiness-2">One end-to-end launch ladder: catalog → checkout → Shiprocket → AWB → pickup.</div></div><button class="secondary" id="ffLaunchReadinessRefresh" type="button">↻ Refresh</button></div><div class="card-body"><div id="ffLaunchReadinessState" data-csp-style="csp-js-admin-launch-readiness-3">Checking first-order readiness…</div><div id="ffLaunchReadinessNext" data-csp-style="csp-js-admin-launch-readiness-4"></div><p data-csp-style="csp-js-admin-launch-readiness-5">Read-only preflight: it never creates an order, payment, refund, shipment, AWB or pickup request.</p></div>';root.appendChild(card);$('ffLaunchReadinessRefresh').onclick=load;load()}
function render(d){const c=d.catalog||{},o=d.orders||{},s=d.shipments||{},checkout=d.checkout||{},ship=d.shiprocket||{};$('ffLaunchReadinessState').innerHTML='<div data-csp-style="csp-js-admin-launch-readiness-6"><div><b>Sellable catalog</b><br>'+badge(c.ready?'ready':'blocked',(c.sellable_skus||0)+' SKU · '+(c.available_units||0)+' units')+'</div><div><b>COD checkout</b><br>'+badge(d.codReady?'ready':'blocked')+'</div><div><b>Prepaid checkout</b><br>'+badge(d.prepaidReady?'ready':'blocked')+'</div><div><b>Shiprocket</b><br>'+badge(d.shiprocketReady?'ready':'blocked',ship.authenticated?'Authenticated':'Auth pending')+'</div><div><b>Packed eligible order</b><br>'+badge((o.packed_eligible||0)>0?'ready':'waiting',String(o.packed_eligible||0))+'</div><div><b>Shipment created</b><br>'+badge((s.total||0)>0?'ready':'waiting',String(s.total||0))+'</div><div><b>AWB assigned</b><br>'+badge((s.awb||0)>0?'ready':'waiting',String(s.awb||0))+'</div><div><b>Pickup requested</b><br>'+badge((s.pickup||0)>0?'ready':'waiting',String(s.pickup||0))+'</div></div><div data-csp-style="csp-js-admin-launch-readiness-7">Active products: '+Number(c.active_products||0)+' · Orders inspected: '+Number(o.total||0)+(checkout.razorpay?.latency_ms!=null?' · Razorpay '+Number(checkout.razorpay.latency_ms)+' ms':'')+(ship.latency_ms!=null?' · Shiprocket '+Number(ship.latency_ms)+' ms':'')+'</div>';
  $('ffLaunchReadinessNext').innerHTML='<div data-csp-style="csp-js-admin-launch-readiness-8"><b>Next safe action</b><div data-csp-style="csp-js-admin-launch-readiness-9">'+esc(d.next)+'</div></div>';
}
async function load(){const state=$('ffLaunchReadinessState');if(!state)return;state.textContent='Checking first-order readiness…';try{render(await snapshot())}catch(e){state.innerHTML='<b data-csp-style="csp-js-admin-launch-readiness-10">Launch readiness unavailable:</b> '+esc(e.message);$('ffLaunchReadinessNext').innerHTML=''}}
function maybeInject(){if(document.getElementById('dashboard')?.dataset.adminReady==='true')inject()}new MutationObserver(maybeInject).observe(document.documentElement,{childList:true,subtree:true,attributes:true});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',maybeInject,{once:true});else maybeInject();
})();

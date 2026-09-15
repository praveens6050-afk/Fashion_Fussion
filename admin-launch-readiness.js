(function(){'use strict';
const BACKEND_URL=location.hostname.endsWith('vercel.app')?location.origin:'https://fashion-fussion-olive.vercel.app';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
function badge(ok,label){return '<span style="font-weight:800;color:'+(ok?'#118344':'#b42318')+'">'+(ok?'Ready':'Blocked')+'</span>'+(label?' <span style="color:#697386">· '+esc(label)+'</span>':'')}
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
function inject(){if($('ffLaunchReadinessCard'))return;const root=document.querySelector('#dashboard .container');if(!root)return;const card=document.createElement('section');card.className='card';card.id='ffLaunchReadinessCard';card.innerHTML='<div class="card-header"><div><h2>First Live Order Readiness</h2><div style="font-size:11px;color:#697386;margin-top:4px">One end-to-end launch ladder: catalog → checkout → Shiprocket → AWB → pickup.</div></div><button class="secondary" id="ffLaunchReadinessRefresh" type="button">↻ Refresh</button></div><div class="card-body"><div id="ffLaunchReadinessState" style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fafbfc;font-size:12px">Checking first-order readiness…</div><div id="ffLaunchReadinessNext" style="margin-top:12px"></div><p style="font-size:11px;color:#697386;margin:12px 0 0">Read-only preflight: it never creates an order, payment, refund, shipment, AWB or pickup request.</p></div>';root.appendChild(card);$('ffLaunchReadinessRefresh').onclick=load;load()}
function render(d){const c=d.catalog||{},o=d.orders||{},s=d.shipments||{},checkout=d.checkout||{},ship=d.shiprocket||{};$('ffLaunchReadinessState').innerHTML='<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px"><div><b>Sellable catalog</b><br>'+badge(c.ready,(c.sellable_skus||0)+' SKU · '+(c.available_units||0)+' units')+'</div><div><b>COD checkout</b><br>'+badge(d.codReady)+'</div><div><b>Prepaid checkout</b><br>'+badge(d.prepaidReady)+'</div><div><b>Shiprocket</b><br>'+badge(d.shiprocketReady,ship.authenticated?'Authenticated':'Auth pending')+'</div><div><b>Packed eligible order</b><br>'+badge((o.packed_eligible||0)>0,String(o.packed_eligible||0))+'</div><div><b>Shipment created</b><br>'+badge((s.total||0)>0,String(s.total||0))+'</div><div><b>AWB assigned</b><br>'+badge((s.awb||0)>0,String(s.awb||0))+'</div><div><b>Pickup requested</b><br>'+badge((s.pickup||0)>0,String(s.pickup||0))+'</div></div><div style="margin-top:10px;color:#697386">Active products: '+Number(c.active_products||0)+' · Orders inspected: '+Number(o.total||0)+(checkout.razorpay?.latency_ms!=null?' · Razorpay '+Number(checkout.razorpay.latency_ms)+' ms':'')+(ship.latency_ms!=null?' · Shiprocket '+Number(ship.latency_ms)+' ms':'')+'</div>';
  $('ffLaunchReadinessNext').innerHTML='<div style="border:1px solid #d7e3ff;background:#f6f9ff;color:#35507a;border-radius:10px;padding:12px 14px"><b>Next safe action</b><div style="margin-top:6px;line-height:1.45">'+esc(d.next)+'</div></div>';
}
async function load(){const state=$('ffLaunchReadinessState');if(!state)return;state.textContent='Checking first-order readiness…';try{render(await snapshot())}catch(e){state.innerHTML='<b style="color:#b42318">Launch readiness unavailable:</b> '+esc(e.message);$('ffLaunchReadinessNext').innerHTML=''}}
new MutationObserver(()=>{if(document.getElementById('dashboard')?.style.display!=='none')inject()}).observe(document.documentElement,{childList:true,subtree:true,attributes:true});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',inject,{once:true});else inject();
})();

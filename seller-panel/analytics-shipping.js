'use strict';

(() => {
  const ORDER_KEY='ff_seller_fulfillment_orders_v1';
  const SHIPPING_KEY='ff_seller_shipping_meta_v1';
  const NOTIFICATION_KEY='ff_seller_notification_reads_v1';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=value=>'₹'+Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  const date=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(d)};
  const notify=message=>window.SellerCatalogBridge?.notify?.(message);
  let initialized=false;
  let observer=null;

  function readOrders(){try{const rows=JSON.parse(localStorage.getItem(ORDER_KEY)||'[]');return Array.isArray(rows)?rows:[]}catch{return[]}}
  function readProducts(){return window.SellerCatalogBridge?.getProducts?.()||[]}
  function readShipping(){try{return JSON.parse(localStorage.getItem(SHIPPING_KEY)||'{}')||{}}catch{return{}}}
  function writeShipping(data){localStorage.setItem(SHIPPING_KEY,JSON.stringify(data))}
  function readReads(){try{return new Set(JSON.parse(localStorage.getItem(NOTIFICATION_KEY)||'[]'))}catch{return new Set()}}
  function writeReads(set){localStorage.setItem(NOTIFICATION_KEY,JSON.stringify([...set]))}

  function init(){
    if(initialized||!window.SellerCatalogBridge||!$('view-orders')||!$('fulfillmentList'))return false;
    initialized=true;
    injectStyles();
    injectNavigation();
    injectAnalyticsView();
    injectShippingView();
    injectNotificationPanel();
    injectOrderModal();
    bindGlobalEvents();
    observeOrders();
    renderAll();
    return true;
  }

  function injectStyles(){
    const style=document.createElement('style');
    style.id='seller-analytics-shipping-style';
    style.textContent=`
      .analytics-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:18px}.analytics-panel{background:#fff;border:1px solid var(--line);border-radius:15px;padding:18px}.analytics-panel h2{font-size:15px;margin:0 0 4px}.analytics-panel>p{font-size:11px;color:var(--muted);margin:0 0 16px}.bar-list{display:grid;gap:12px}.bar-row{display:grid;grid-template-columns:minmax(110px,1fr) 2fr auto;gap:10px;align-items:center}.bar-label{font-size:11px;color:#465063;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{height:8px;background:#edf0f4;border-radius:999px;overflow:hidden}.bar-fill{height:100%;background:#4f7cff;border-radius:999px;min-width:4px}.bar-value{font-size:10px;color:#727c8d;font-weight:700}.insight-list{display:grid;gap:10px}.insight{padding:12px;border:1px solid #e8ebf0;border-radius:11px;background:#fafbfc}.insight strong{display:block;font-size:12px}.insight span{display:block;font-size:10px;color:#7f8897;margin-top:4px;line-height:1.45}
      .shipping-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:17px 18px;border-bottom:1px solid #eef0f4}.shipping-card:last-child{border-bottom:0}.shipping-id{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.shipping-id strong{font-size:13px}.shipping-meta{font-size:10px;color:#7d8696;margin-top:4px}.shipping-lines{margin-top:9px;font-size:11px;color:#505a6a}.shipping-side{display:grid;justify-items:end;gap:8px}.shipping-side select{border:1px solid #dfe3ea;border-radius:8px;padding:7px 9px;background:#fff;font-size:11px}.tracking-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;background:#f3f5f8;padding:4px 6px;border-radius:6px;color:#5e6878}.ship-status{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:9px;font-weight:800}.ship-status.unassigned{background:#f3f5f8;color:#6b7280}.ship-status.assigned{background:#eef4ff;color:#315fbd}.ship-status.pickup{background:#fff6df;color:#97620b}.ship-status.shipped{background:#eaf8f0;color:#128a53}
      .notification-panel{position:fixed;top:66px;right:28px;width:min(390px,92vw);max-height:70vh;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 22px 55px rgba(17,24,39,.18);z-index:90;display:none;overflow:hidden}.notification-panel.open{display:block}.notification-head{display:flex;align-items:center;justify-content:space-between;padding:14px 15px;border-bottom:1px solid var(--line)}.notification-head h3{font-size:14px;margin:0}.notification-list{max-height:56vh;overflow:auto}.notification-item{display:grid;grid-template-columns:10px 1fr;gap:10px;padding:13px 15px;border-bottom:1px solid #eff1f4;cursor:pointer}.notification-item:last-child{border-bottom:0}.notification-item.unread{background:#f7faff}.notification-dot{width:8px;height:8px;border-radius:50%;background:#4f7cff;margin-top:4px}.notification-item:not(.unread) .notification-dot{background:#d5dae2}.notification-item strong{display:block;font-size:11px}.notification-item span{display:block;font-size:10px;color:#7a8494;margin-top:3px;line-height:1.45}.notification-count{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#e54848;color:#fff;font-size:9px;font-style:normal;font-weight:800;display:grid;place-items:center;border:2px solid #fff}
      .order-modal-backdrop{position:fixed;inset:0;background:rgba(14,20,31,.5);z-index:95;display:none}.order-modal-backdrop.open{display:block}.order-modal{position:absolute;inset:5vh max(18px,calc((100vw - 760px)/2));background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column}.order-modal-head{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px;border-bottom:1px solid var(--line)}.order-modal-head h2{margin:3px 0 0;font-size:20px}.order-modal-body{padding:20px;overflow:auto}.order-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.detail-card{border:1px solid #e7eaf0;border-radius:11px;padding:13px}.detail-card h4{margin:0 0 8px;font-size:11px;color:#6f7888;text-transform:uppercase;letter-spacing:.6px}.detail-card strong,.detail-card span{display:block}.detail-card strong{font-size:12px}.detail-card span{font-size:10px;color:#7d8696;margin-top:4px}.document-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.order-line-table{width:100%;border-collapse:collapse;margin-top:16px}.order-line-table th,.order-line-table td{padding:10px;border-bottom:1px solid #edf0f3;text-align:left;font-size:10px}.order-line-table th{color:#8992a1;background:#fafbfc}.order-line-table td strong{font-size:11px}.details-btn{white-space:nowrap}
      @media(max-width:900px){.analytics-grid{grid-template-columns:1fr}.shipping-card{grid-template-columns:1fr}.shipping-side{justify-items:start}.order-detail-grid{grid-template-columns:1fr}.notification-panel{right:12px}}
    `;
    document.head.appendChild(style);
  }

  function injectNavigation(){
    const orders=document.querySelector('.nav-item[data-view="orders"]');
    if(orders&&!document.querySelector('.nav-item[data-view="analytics"]')){
      const analytics=document.createElement('button');analytics.className='nav-item';analytics.dataset.view='analytics';analytics.innerHTML='<span>◫</span>Analytics';orders.insertAdjacentElement('beforebegin',analytics);
    }
    const payments=document.querySelector('.nav-item[data-view="payments"]');
    if(payments&&!document.querySelector('.nav-item[data-view="shipping"]')){
      const shipping=document.createElement('button');shipping.className='nav-item';shipping.dataset.view='shipping';shipping.innerHTML='<span>⇢</span>Shipping <b id="navShippingCount">0</b>';payments.insertAdjacentElement('beforebegin',shipping);
    }
  }

  function injectAnalyticsView(){
    if($('view-analytics'))return;
    const orders=$('view-orders');const section=document.createElement('section');section.className='content view';section.id='view-analytics';section.innerHTML=`
      <div class="page-head"><div><p class="eyebrow">BUSINESS PERFORMANCE</p><h1>Analytics</h1><p>Standalone performance preview built from this seller demo catalog and fulfilment data.</p></div><button class="ghost" id="refreshAnalytics">Refresh metrics</button></div>
      <div class="metric-grid"><article class="metric-card"><span>Gross order value</span><strong id="analyticsRevenue">₹0</strong><small>Non-cancelled demo orders</small></article><article class="metric-card"><span>Orders</span><strong id="analyticsOrders">0</strong><small id="analyticsActive">0 active</small></article><article class="metric-card"><span>Units ordered</span><strong id="analyticsUnits">0</strong><small>Across all order lines</small></article><article class="metric-card"><span>Live catalog</span><strong id="analyticsLive">0</strong><small id="analyticsCatalogTotal">0 total listings</small></article></div>
      <div class="analytics-grid"><section class="analytics-panel"><h2>Top products by ordered units</h2><p>Calculated from the local fulfilment demo.</p><div id="topProductBars" class="bar-list"></div></section><section class="analytics-panel"><h2>Seller insights</h2><p>Operational signals requiring attention.</p><div id="sellerInsights" class="insight-list"></div></section></div>`;
    orders.insertAdjacentElement('beforebegin',section);$('refreshAnalytics')?.addEventListener('click',renderAnalytics);
  }

  function injectShippingView(){
    if($('view-shipping'))return;
    const payments=$('view-payments');const section=document.createElement('section');section.className='content view';section.id='view-shipping';section.innerHTML=`
      <div class="page-head"><div><p class="eyebrow">LOGISTICS</p><h1>Shipping</h1><p>Prepare dispatch, courier assignment, pickup status and tracking before real logistics integration.</p></div></div>
      <div class="notice info"><div class="notice-icon">i</div><div><strong>Demo logistics only</strong><p>Courier names, AWB numbers and pickups below are locally generated placeholders and do not create real shipments.</p></div></div>
      <div class="metric-grid"><article class="metric-card"><span>Needs dispatch</span><strong id="shippingNeeds">0</strong><small>Packed / ready orders</small></article><article class="metric-card"><span>Courier assigned</span><strong id="shippingAssigned">0</strong><small>Demo assignment saved</small></article><article class="metric-card"><span>Pickup scheduled</span><strong id="shippingPickup">0</strong><small>Awaiting handover</small></article><article class="metric-card"><span>Shipped</span><strong id="shippingShipped">0</strong><small>Fulfilment status shipped</small></article></div>
      <section class="panel"><div class="panel-head"><div><h2>Shipment queue</h2><p>Only fulfilment orders relevant to dispatch are shown.</p></div></div><div id="shippingQueue"></div></section>`;
    payments.insertAdjacentElement('beforebegin',section);
  }

  function injectNotificationPanel(){
    const bell=document.querySelector('.top-actions .icon-btn');if(!bell)return;bell.id='sellerNotificationsButton';bell.setAttribute('aria-label','Seller notifications');bell.style.position='relative';
    let count=document.createElement('span');count.className='notification-count';count.id='sellerNotificationCount';bell.appendChild(count);
    const panel=document.createElement('aside');panel.className='notification-panel';panel.id='sellerNotificationPanel';panel.innerHTML='<div class="notification-head"><h3>Notifications</h3><button class="link-btn" id="markNotificationsRead">Mark all read</button></div><div class="notification-list" id="sellerNotificationList"></div>';document.body.appendChild(panel);
    bell.addEventListener('click',event=>{event.stopPropagation();panel.classList.toggle('open');if(panel.classList.contains('open'))renderNotifications()});
    $('markNotificationsRead')?.addEventListener('click',()=>{const reads=readReads();buildNotifications().forEach(item=>reads.add(item.id));writeReads(reads);renderNotifications()});
  }

  function injectOrderModal(){
    const wrap=document.createElement('div');wrap.className='order-modal-backdrop';wrap.id='sellerOrderModal';wrap.innerHTML='<section class="order-modal" role="dialog" aria-modal="true"><div class="order-modal-head"><div><p class="eyebrow">ORDER DETAILS</p><h2 id="orderModalTitle">Order</h2></div><button class="close-btn" id="closeOrderModal">×</button></div><div class="order-modal-body" id="orderModalBody"></div></section>';document.body.appendChild(wrap);
    $('closeOrderModal')?.addEventListener('click',closeOrderModal);wrap.addEventListener('click',event=>{if(event.target===wrap)closeOrderModal()});
  }

  function observeOrders(){
    const list=$('fulfillmentList');if(!list)return;observer=new MutationObserver(()=>{decorateOrderCards();renderAllDerived()});observer.observe(list,{childList:true,subtree:true});decorateOrderCards();
  }

  function decorateOrderCards(){
    document.querySelectorAll('#fulfillmentList .fulfillment-card').forEach(card=>{
      if(card.querySelector('[data-order-detail]'))return;
      const id=card.querySelector('.fulfillment-id strong')?.textContent?.trim();const actions=card.querySelector('.fulfillment-actions');if(!id||!actions)return;
      const button=document.createElement('button');button.className='small-btn details-btn';button.dataset.orderDetail=id;button.textContent='Details';actions.prepend(button);
    });
  }

  function buildNotifications(){
    const items=[];const products=readProducts();const orders=readOrders();
    products.filter(p=>p.status==='rejected').forEach(p=>items.push({id:`rejected:${p.id}`,title:`Listing rejected: ${p.name}`,text:p.rejectionReason||'Changes required before resubmission.',view:'review'}));
    products.filter(p=>Number(p.stock||0)<=Number(p.lowStockThreshold??5)).forEach(p=>items.push({id:`stock:${p.id}`,title:`Low stock: ${p.name}`,text:`${Number(p.stock||0)} units available. Review inventory.`,view:'inventory'}));
    orders.filter(o=>o.status==='new').forEach(o=>items.push({id:`order:${o.id}`,title:`New order ${o.id}`,text:`${o.customer} · ${money(o.total)}`,view:'orders'}));
    orders.filter(o=>o.status==='ready_to_ship').forEach(o=>items.push({id:`ship:${o.id}`,title:`Ready to ship ${o.id}`,text:'Assign courier and prepare pickup.',view:'shipping'}));
    return items.slice(0,30);
  }

  function renderNotifications(){
    const reads=readReads(),items=buildNotifications();const unread=items.filter(item=>!reads.has(item.id)).length;const count=$('sellerNotificationCount');if(count){count.textContent=unread>9?'9+':String(unread);count.style.display=unread?'grid':'none'}
    const list=$('sellerNotificationList');if(list)list.innerHTML=items.length?items.map(item=>`<div class="notification-item ${reads.has(item.id)?'':'unread'}" data-notification-id="${esc(item.id)}" data-notification-view="${esc(item.view)}"><i class="notification-dot"></i><div><strong>${esc(item.title)}</strong><span>${esc(item.text)}</span></div></div>`).join(''):'<div class="inventory-empty"><strong>All clear</strong>No seller alerts right now.</div>';
  }

  function renderAnalytics(){
    const orders=readOrders(),products=readProducts(),valid=orders.filter(o=>o.status!=='cancelled');const revenue=valid.reduce((s,o)=>s+Number(o.total||0),0),units=valid.reduce((s,o)=>s+o.lines.reduce((a,l)=>a+Number(l.qty||0),0),0),active=orders.filter(o=>!['shipped','cancelled'].includes(o.status)).length,live=products.filter(p=>p.status==='approved').length;
    $('analyticsRevenue').textContent=money(revenue);$('analyticsOrders').textContent=orders.length;$('analyticsActive').textContent=`${active} active`;$('analyticsUnits').textContent=units;$('analyticsLive').textContent=live;$('analyticsCatalogTotal').textContent=`${products.length} total listings`;
    const byProduct=new Map();valid.forEach(o=>o.lines.forEach(l=>byProduct.set(l.name,(byProduct.get(l.name)||0)+Number(l.qty||0))));const sorted=[...byProduct.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6),max=Math.max(1,...sorted.map(x=>x[1]));$('topProductBars').innerHTML=sorted.length?sorted.map(([name,value])=>`<div class="bar-row"><span class="bar-label">${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,value/max*100)}%"></div></div><span class="bar-value">${value} units</span></div>`).join(''):'<div class="inventory-empty">No order data yet.</div>';
    const low=products.filter(p=>Number(p.stock||0)<=Number(p.lowStockThreshold??5)).length,rejected=products.filter(p=>p.status==='rejected').length,ready=orders.filter(o=>o.status==='ready_to_ship').length,newOrders=orders.filter(o=>o.status==='new').length;const insights=[[`${newOrders} new order${newOrders===1?'':'s'}`,'Accept new orders from the fulfilment queue.'],[`${ready} ready for dispatch`,'Assign courier and prepare pickup in Shipping.'],[`${low} low/out-of-stock listing${low===1?'':'s'}`,'Review available units in Inventory.'],[`${rejected} rejected listing${rejected===1?'':'s'}`,'Fix rejection reasons and resubmit for admin review.']];$('sellerInsights').innerHTML=insights.map(([title,text])=>`<div class="insight"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`).join('');
  }

  function shippingStatus(order,meta){if(order.status==='shipped')return'shipped';if(meta?.pickupScheduled)return'pickup';if(meta?.carrier)return'assigned';return'unassigned'}
  function renderShipping(){
    const orders=readOrders().filter(o=>['packed','ready_to_ship','shipped'].includes(o.status)),shipping=readShipping();let assigned=0,pickup=0;orders.forEach(o=>{if(shipping[o.id]?.carrier)assigned++;if(shipping[o.id]?.pickupScheduled)pickup++});const needs=orders.filter(o=>['packed','ready_to_ship'].includes(o.status)).length,shipped=orders.filter(o=>o.status==='shipped').length;$('shippingNeeds').textContent=needs;$('shippingAssigned').textContent=assigned;$('shippingPickup').textContent=pickup;$('shippingShipped').textContent=shipped;if($('navShippingCount'))$('navShippingCount').textContent=needs;
    const queue=$('shippingQueue');if(!queue)return;queue.innerHTML=orders.length?orders.map(order=>{const meta=shipping[order.id]||{},status=shippingStatus(order,meta),statusLabel={unassigned:'Courier unassigned',assigned:'Courier assigned',pickup:'Pickup scheduled',shipped:'Shipped'}[status];return`<article class="shipping-card"><div><div class="shipping-id"><strong>${esc(order.id)}</strong><span class="ship-status ${status}">${esc(statusLabel)}</span>${meta.awb?`<code class="tracking-code">AWB ${esc(meta.awb)}</code>`:''}</div><div class="shipping-meta">${esc(order.customer)} · ${date(order.date)} · ${money(order.total)}</div><div class="shipping-lines">${order.lines.map(l=>`${l.qty}× ${esc(l.name)}`).join(' · ')}</div></div><div class="shipping-side">${order.status==='shipped'?`<span class="tracking-code">Shipment handed over</span>`:`<select data-carrier-order="${esc(order.id)}"><option value="">Select demo courier</option>${['Delhivery Demo','BlueDart Demo','Xpressbees Demo','Self Ship Demo'].map(c=>`<option ${meta.carrier===c?'selected':''}>${c}</option>`).join('')}</select><div class="fulfillment-actions"><button class="small-btn" data-shipping-pickup="${esc(order.id)}" ${meta.carrier?'':'disabled'}>${meta.pickupScheduled?'Pickup scheduled':'Schedule pickup'}</button><button class="small-btn" data-order-detail="${esc(order.id)}">Documents</button></div>`}</div></article>`}).join(''):'<div class="inventory-empty"><strong>No shipments yet</strong>Pack an order to move it into the logistics queue.</div>';
  }

  function renderAllDerived(){renderAnalytics();renderShipping();renderNotifications()}
  function renderAll(){renderAllDerived();decorateOrderCards()}

  function bindGlobalEvents(){
    document.addEventListener('click',event=>{
      if(!event.target.closest('#sellerNotificationPanel')&&!event.target.closest('#sellerNotificationsButton'))$('sellerNotificationPanel')?.classList.remove('open');
      const detail=event.target.closest('[data-order-detail]');if(detail){openOrderModal(detail.dataset.orderDetail);return}
      const notification=event.target.closest('[data-notification-id]');if(notification){const reads=readReads();reads.add(notification.dataset.notificationId);writeReads(reads);$('sellerNotificationPanel')?.classList.remove('open');document.querySelector(`.nav-item[data-view="${CSS.escape(notification.dataset.notificationView)}"]`)?.click();renderNotifications();return}
      const pickup=event.target.closest('[data-shipping-pickup]');if(pickup){schedulePickup(pickup.dataset.shippingPickup);return}
      const print=event.target.closest('[data-print-doc]');if(print){printDocument(print.dataset.printDoc,print.dataset.orderId);return}
    });
    document.addEventListener('change',event=>{const carrier=event.target.closest('[data-carrier-order]');if(carrier)assignCarrier(carrier.dataset.carrierOrder,carrier.value)});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeOrderModal();$('sellerNotificationPanel')?.classList.remove('open')}});
    window.addEventListener('storage',event=>{if([ORDER_KEY,SHIPPING_KEY].includes(event.key))renderAllDerived()});
    const originalCommit=window.SellerCatalogBridge.commit;window.SellerCatalogBridge.commit=next=>{originalCommit(next);setTimeout(renderAllDerived,0)};
  }

  function assignCarrier(orderId,carrier){const all=readShipping();if(!all[orderId])all[orderId]={};all[orderId].carrier=carrier;all[orderId].awb=carrier?all[orderId].awb||`FF${Date.now().toString().slice(-9)}`:'';if(!carrier){all[orderId].pickupScheduled=false;all[orderId].awb=''}writeShipping(all);renderShipping();renderNotifications();notify(carrier?`${orderId}: demo courier assigned.`:`${orderId}: courier cleared.`)}
  function schedulePickup(orderId){const all=readShipping();const meta=all[orderId]||{};if(!meta.carrier){notify('Assign a demo courier first.');return}meta.pickupScheduled=true;meta.pickupDate=new Date(Date.now()+24*60*60*1000).toISOString();all[orderId]=meta;writeShipping(all);renderShipping();notify(`${orderId}: demo pickup scheduled.`)}

  function openOrderModal(orderId){const order=readOrders().find(o=>o.id===orderId);if(!order){notify('Order details are unavailable.');return}const shipping=readShipping()[order.id]||{};$('orderModalTitle').textContent=order.id;$('orderModalBody').innerHTML=`<div class="order-detail-grid"><div class="detail-card"><h4>Customer</h4><strong>${esc(order.customer)}</strong><span>Demo customer record</span></div><div class="detail-card"><h4>Order summary</h4><strong>${money(order.total)}</strong><span>${date(order.date)} · ${esc(order.status.replaceAll('_',' '))}</span></div><div class="detail-card"><h4>Shipping</h4><strong>${esc(shipping.carrier||'Courier not assigned')}</strong><span>${shipping.awb?`AWB ${esc(shipping.awb)}`:'Tracking not generated yet'}</span></div><div class="detail-card"><h4>Seller action</h4><strong>${order.status==='shipped'?'Shipment completed':'Fulfilment in progress'}</strong><span>All data is local prototype data.</span></div></div><table class="order-line-table"><thead><tr><th>ITEM</th><th>SKU</th><th>QTY</th></tr></thead><tbody>${order.lines.map(line=>`<tr><td><strong>${esc(line.name)}</strong></td><td>${esc(line.sku)}</td><td>${Number(line.qty||0)}</td></tr>`).join('')}</tbody></table><div class="document-actions"><button class="primary" data-print-doc="invoice" data-order-id="${esc(order.id)}">Invoice preview</button><button class="ghost" data-print-doc="packing" data-order-id="${esc(order.id)}">Packing slip</button></div>`;$('sellerOrderModal').classList.add('open')}
  function closeOrderModal(){$('sellerOrderModal')?.classList.remove('open')}

  function printDocument(type,orderId){const order=readOrders().find(o=>o.id===orderId);if(!order)return;const shipping=readShipping()[order.id]||{},title=type==='packing'?'Packing Slip':'Seller Invoice Preview',subtotal=Number(order.total||0);const popup=window.open('','_blank','width=820,height=900');if(!popup){notify('Allow pop-ups to open the printable document.');return}popup.document.write(`<!doctype html><html><head><title>${esc(title)} ${esc(order.id)}</title><style>body{font-family:Arial,sans-serif;color:#182033;padding:34px}h1{margin:0;font-size:24px}.muted{color:#6b7280;font-size:12px}.head{display:flex;justify-content:space-between;gap:30px;border-bottom:2px solid #182033;padding-bottom:18px}.box{margin-top:18px;padding:14px;border:1px solid #dfe3ea;border-radius:8px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e8ebef;font-size:12px}th{background:#f5f6f8}.total{text-align:right;margin-top:18px;font-size:18px}.note{margin-top:28px;font-size:11px;color:#6b7280}@media print{button{display:none}}</style></head><body><div class="head"><div><h1>${esc(title)}</h1><div class="muted">Fashion_Fussion Seller Center · Standalone Prototype</div></div><div><strong>${esc(order.id)}</strong><div class="muted">${date(order.date)}</div></div></div><div class="box"><strong>Ship to: ${esc(order.customer)}</strong><div class="muted">Demo address intentionally omitted · ${esc(shipping.carrier||'Courier not assigned')} ${shipping.awb?`· AWB ${esc(shipping.awb)}`:''}</div></div><table><thead><tr><th>Product</th><th>SKU</th><th>Qty</th></tr></thead><tbody>${order.lines.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.sku)}</td><td>${Number(l.qty||0)}</td></tr>`).join('')}</tbody></table>${type==='invoice'?`<div class="total"><strong>Order value: ${money(subtotal)}</strong></div>`:''}<div class="note">Prototype document only. This is not a tax invoice, GST invoice, shipping label, or proof of dispatch.</div><script>window.onload=()=>window.print()<\/script></body></html>`);popup.document.close()}

  const timer=setInterval(()=>{if(init())clearInterval(timer)},80);setTimeout(()=>clearInterval(timer),8000);
})();
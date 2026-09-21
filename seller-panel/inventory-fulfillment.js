'use strict';

(() => {
  const bridge = window.SellerCatalogBridge;
  if (!bridge) return;

  const ORDER_KEY = 'ff_seller_fulfillment_orders_v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', {maximumFractionDigits: 2});
  const formatDate = value => new Intl.DateTimeFormat('en-IN', {day:'2-digit', month:'short', year:'numeric'}).format(new Date(value));

  const starterOrders = [
    {id:'FFO-240918-1042',date:'2026-09-18T18:10:00+05:30',customer:'Aarav Mehta',total:1598,status:'new',lines:[{sku:'FF-TSH-104',name:'Premium Cotton Oversized T-Shirt',qty:2}]},
    {id:'FFO-240918-1038',date:'2026-09-18T15:42:00+05:30',customer:'Neha Verma',total:899,status:'accepted',lines:[{sku:'FF-DSK-011',name:'Minimal Desk Organizer Set',qty:1}]},
    {id:'FFO-240917-1021',date:'2026-09-17T13:20:00+05:30',customer:'Rohan Gupta',total:2397,status:'packed',lines:[{sku:'FF-TSH-104',name:'Premium Cotton Oversized T-Shirt',qty:3}]},
    {id:'FFO-240916-0994',date:'2026-09-16T11:05:00+05:30',customer:'Simran Kaur',total:799,status:'ready_to_ship',lines:[{sku:'FF-TSH-104',name:'Premium Cotton Oversized T-Shirt',qty:1}]},
    {id:'FFO-240915-0962',date:'2026-09-15T16:31:00+05:30',customer:'Kabir Singh',total:1298,status:'shipped',lines:[{sku:'FF-WRT-203',name:'Women Ribbed Everyday Top',qty:2}]}
  ];

  let orders = loadOrders();
  let inventoryFilter = 'all';
  let inventoryQuery = '';
  let pendingStock = new Map();
  let orderFilter = 'active';

  injectStyles();
  injectInventoryNavigation();
  injectInventoryView();
  upgradeOrdersView();
  renderInventory();
  renderFulfillment();

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'seller-inventory-fulfillment-style';
    style.textContent = `
      .inventory-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
      .inventory-filters{display:flex;gap:6px;flex-wrap:wrap}.inventory-filter{border:0;background:#f3f5f8;color:#60697a;border-radius:8px;padding:8px 10px;font-size:11px;font-weight:800;cursor:pointer}.inventory-filter.active{background:#e8f0ff;color:#2f62c9}
      .inventory-actions{display:flex;gap:8px;align-items:center}.inventory-search{width:220px;height:36px;border:1px solid var(--line);border-radius:9px;padding:0 10px;outline:0}
      .inventory-table{width:100%;border-collapse:collapse}.inventory-table th,.inventory-table td{padding:13px 16px;border-bottom:1px solid #eef0f4;text-align:left;vertical-align:middle}.inventory-table th{font-size:9px;letter-spacing:.65px;color:#8a93a2;background:#fafbfc}.inventory-table td{font-size:12px}
      .inventory-product{display:flex;gap:10px;align-items:center;min-width:230px}.inventory-product strong,.inventory-product span{display:block}.inventory-product span{margin-top:3px;color:#7d8696;font-size:10px}.inventory-sku{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:#5d6677}
      .stock-input{width:86px;border:1px solid #dce1e8;border-radius:8px;padding:8px 9px;outline:0}.stock-input:focus{border-color:#7da1f4;box-shadow:0 0 0 3px rgba(47,111,237,.1)}.stock-input.changed{border-color:#d79a2d;background:#fff9e9}
      .stock-state{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:800}.stock-state:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.stock-state.healthy{color:#128a53;background:#eaf8f0}.stock-state.low{color:#a96800;background:#fff6df}.stock-state.out{color:#c23b3b;background:#fff0f0}
      .variant-inventory-row{background:#fafbfc}.variant-inventory-row td:first-child{padding-left:46px}.variant-label{font-size:10px;color:#697386}.variant-label strong{font-size:11px;color:#3f4755}
      .inventory-savebar{display:none;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#fff8e8;border-top:1px solid #f0d9a6;position:sticky;bottom:0}.inventory-savebar.show{display:flex}.inventory-savebar span{font-size:11px;color:#765514;font-weight:700}
      .fulfillment-tabs{display:flex;gap:6px;flex-wrap:wrap}.fulfillment-tab{border:0;background:#f2f4f7;color:#616a79;padding:8px 10px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer}.fulfillment-tab.active{background:#e8f0ff;color:#2f62c9}
      .fulfillment-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:16px 18px;border-bottom:1px solid #eef0f4}.fulfillment-card:last-child{border-bottom:0}.fulfillment-id{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.fulfillment-id strong{font-size:13px}.fulfillment-meta{margin-top:4px;color:#7d8696;font-size:10px}.fulfillment-lines{margin-top:10px;display:grid;gap:5px}.fulfillment-line{display:flex;gap:8px;align-items:center;font-size:11px;color:#4e5868}.fulfillment-line code{font-size:9px;color:#6e7788;background:#f4f6f8;padding:3px 5px;border-radius:5px}.fulfillment-side{text-align:right;display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:12px}.fulfillment-side>strong{font-size:14px}.fulfillment-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
      .order-stage{display:inline-flex;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:800}.order-stage.new{background:#eef4ff;color:#3564c7}.order-stage.accepted{background:#f3efff;color:#6a4fc6}.order-stage.packed{background:#fff6df;color:#9b6507}.order-stage.ready_to_ship{background:#eaf8f0;color:#128a53}.order-stage.shipped{background:#e9f3ff;color:#1f6eae}.order-stage.cancelled{background:#fff0f0;color:#c23b3b}
      .fulfillment-stepper{display:flex;align-items:center;gap:5px;margin-top:9px;flex-wrap:wrap}.fulfillment-step{display:flex;align-items:center;gap:5px;color:#9aa2b1;font-size:9px;font-weight:700}.fulfillment-step:after{content:"›";color:#c8ced7}.fulfillment-step:last-child:after{display:none}.fulfillment-step.done{color:#28835b}.fulfillment-step.current{color:#315fbd}
      .danger-outline{border-color:#f0c9c9!important;color:#ba4141!important}.inventory-empty{padding:54px 20px;text-align:center;color:#7c8595}.inventory-empty strong{display:block;color:#303849;margin-bottom:5px}
      @media(max-width:900px){.inventory-actions{width:100%}.inventory-search{flex:1}.fulfillment-card{grid-template-columns:1fr}.fulfillment-side{align-items:flex-start;text-align:left}.fulfillment-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function injectInventoryNavigation() {
    const ordersButton = document.querySelector('.nav-item[data-view="orders"]');
    if (!ordersButton || document.querySelector('.nav-item[data-view="inventory"]')) return;
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'inventory';
    button.innerHTML = '<span>▤</span>Inventory <b id="navLowStockCount">0</b>';
    ordersButton.insertAdjacentElement('beforebegin', button);
  }

  function injectInventoryView() {
    if ($('view-inventory')) return;
    const ordersView = $('view-orders');
    const section = document.createElement('section');
    section.className = 'content view';
    section.id = 'view-inventory';
    section.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">STOCK CONTROL</p><h1>Inventory</h1><p>Update product and variant stock, identify low inventory and prepare for future order synchronization.</p></div>
        <button class="primary" id="inventorySaveTop">Save stock changes</button>
      </div>
      <div class="notice info"><div class="notice-icon">i</div><div><strong>Standalone stock workspace</strong><p>Changes are stored only in the seller prototype. Inventory is not connected to customer checkout, admin, warehouse or logistics yet.</p></div></div>
      <div class="metric-grid">
        <article class="metric-card"><span>Total stock units</span><strong id="inventoryTotalUnits">0</strong><small>Across all seller listings</small></article>
        <article class="metric-card"><span>Low-stock listings</span><strong id="inventoryLowCount">0</strong><small>At or below threshold</small></article>
        <article class="metric-card"><span>Out of stock</span><strong id="inventoryOutCount">0</strong><small>Requires replenishment</small></article>
        <article class="metric-card"><span>Variant SKUs</span><strong id="inventoryVariantCount">0</strong><small>SKU-level inventory rows</small></article>
      </div>
      <section class="panel">
        <div class="inventory-toolbar">
          <div class="inventory-filters" id="inventoryFilters">
            <button class="inventory-filter active" data-inventory-filter="all">All</button>
            <button class="inventory-filter" data-inventory-filter="low">Low stock</button>
            <button class="inventory-filter" data-inventory-filter="out">Out of stock</button>
            <button class="inventory-filter" data-inventory-filter="variants">With variants</button>
          </div>
          <div class="inventory-actions"><input class="inventory-search" id="inventorySearch" type="search" placeholder="Search product or SKU"><button class="ghost" id="inventoryRestockLow">+10 to low stock</button></div>
        </div>
        <div class="table-wrap"><table class="inventory-table"><thead><tr><th>PRODUCT / VARIANT</th><th>SKU</th><th>AVAILABLE</th><th>LOW-STOCK LIMIT</th><th>STATE</th></tr></thead><tbody id="inventoryRows"></tbody></table></div>
        <div class="inventory-savebar" id="inventorySavebar"><span id="inventoryPendingText">Unsaved inventory changes</span><div><button class="ghost" id="inventoryDiscard">Discard</button> <button class="primary" id="inventorySave">Save changes</button></div></div>
      </section>`;
    ordersView.insertAdjacentElement('beforebegin', section);

    $('inventorySearch').addEventListener('input', event => { inventoryQuery = event.target.value.trim().toLowerCase(); renderInventoryRows(); });
    $('inventoryFilters').addEventListener('click', event => {
      const button = event.target.closest('[data-inventory-filter]');
      if (!button) return;
      inventoryFilter = button.dataset.inventoryFilter;
      document.querySelectorAll('[data-inventory-filter]').forEach(item => item.classList.toggle('active', item === button));
      renderInventoryRows();
    });
    $('inventoryRows').addEventListener('input', handleStockInput);
    $('inventorySave').addEventListener('click', saveInventoryChanges);
    $('inventorySaveTop').addEventListener('click', saveInventoryChanges);
    $('inventoryDiscard').addEventListener('click', () => { pendingStock.clear(); renderInventory(); notify('Unsaved stock changes discarded.'); });
    $('inventoryRestockLow').addEventListener('click', restockLowInventory);
  }

  function productThreshold(product) {
    return Number.isInteger(Number(product.lowStockThreshold)) ? Math.max(0, Number(product.lowStockThreshold)) : 5;
  }

  function inventoryState(stock, threshold) {
    if (stock <= 0) return 'out';
    if (stock <= threshold) return 'low';
    return 'healthy';
  }

  function stockStateHtml(stock, threshold) {
    const state = inventoryState(stock, threshold);
    const label = state === 'out' ? 'Out of stock' : state === 'low' ? 'Low stock' : 'Healthy';
    return `<span class="stock-state ${state}">${label}</span>`;
  }

  function stockKey(productId, variantIndex = null) {
    return variantIndex === null ? `p:${productId}` : `v:${productId}:${variantIndex}`;
  }

  function effectiveStock(product, variantIndex = null) {
    const key = stockKey(product.id, variantIndex);
    if (pendingStock.has(key)) return pendingStock.get(key);
    if (variantIndex !== null) return Number(product.variants?.[variantIndex]?.stock || 0);
    return Number(product.stock || 0);
  }

  function inventoryMatches(product) {
    const stock = effectiveStock(product);
    const threshold = productThreshold(product);
    const queryMatch = !inventoryQuery || [product.name, product.sku, product.brand, product.category, ...(product.variants || []).map(v => v.sku)].some(value => String(value || '').toLowerCase().includes(inventoryQuery));
    if (!queryMatch) return false;
    if (inventoryFilter === 'low') return stock > 0 && stock <= threshold;
    if (inventoryFilter === 'out') return stock <= 0;
    if (inventoryFilter === 'variants') return product.variantsEnabled && Array.isArray(product.variants) && product.variants.length > 0;
    return true;
  }

  function renderInventory() {
    const products = bridge.getProducts();
    const totalUnits = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
    const low = products.filter(product => Number(product.stock || 0) > 0 && Number(product.stock || 0) <= productThreshold(product)).length;
    const out = products.filter(product => Number(product.stock || 0) <= 0).length;
    const variants = products.reduce((sum, product) => sum + (Array.isArray(product.variants) ? product.variants.length : 0), 0);
    if ($('inventoryTotalUnits')) $('inventoryTotalUnits').textContent = totalUnits.toLocaleString('en-IN');
    if ($('inventoryLowCount')) $('inventoryLowCount').textContent = low;
    if ($('inventoryOutCount')) $('inventoryOutCount').textContent = out;
    if ($('inventoryVariantCount')) $('inventoryVariantCount').textContent = variants;
    if ($('navLowStockCount')) $('navLowStockCount').textContent = low + out;
    renderInventoryRows();
    syncSavebar();
  }

  function renderInventoryRows() {
    const body = $('inventoryRows');
    if (!body) return;
    const products = bridge.getProducts().filter(inventoryMatches);
    if (!products.length) {
      body.innerHTML = '<tr><td colspan="5"><div class="inventory-empty"><strong>No inventory rows found</strong>Try another search or stock filter.</div></td></tr>';
      return;
    }
    body.innerHTML = products.map(product => {
      const threshold = productThreshold(product);
      const parentStock = effectiveStock(product);
      const hasVariants = product.variantsEnabled && Array.isArray(product.variants) && product.variants.length;
      const parent = `<tr>
        <td><div class="inventory-product"><div class="thumb">${esc(String(product.name || 'P').split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase())}</div><div><strong>${esc(product.name)}</strong><span>${esc(product.brand || product.category || 'Product')}</span></div></div></td>
        <td><span class="inventory-sku">${esc(product.sku)}</span></td>
        <td><input class="stock-input ${pendingStock.has(stockKey(product.id)) ? 'changed' : ''}" data-stock-product="${esc(product.id)}" type="number" min="0" step="1" value="${parentStock}" ${hasVariants ? 'readonly title="Calculated from variant stock"' : ''}></td>
        <td>${threshold}</td><td>${stockStateHtml(parentStock, threshold)}</td>
      </tr>`;
      if (!hasVariants) return parent;
      return parent + product.variants.map((variant, index) => {
        const variantStock = effectiveStock(product, index);
        return `<tr class="variant-inventory-row"><td><div class="variant-label"><strong>${esc([variant.size, variant.color].filter(Boolean).join(' / ') || 'Variant')}</strong><span>Variant inventory</span></div></td><td><span class="inventory-sku">${esc(variant.sku)}</span></td><td><input class="stock-input ${pendingStock.has(stockKey(product.id, index)) ? 'changed' : ''}" data-stock-product="${esc(product.id)}" data-stock-variant="${index}" type="number" min="0" step="1" value="${variantStock}"></td><td>${threshold}</td><td>${stockStateHtml(variantStock, threshold)}</td></tr>`;
      }).join('');
    }).join('');
  }

  function handleStockInput(event) {
    const input = event.target.closest('[data-stock-product]');
    if (!input || input.readOnly) return;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 0) return;
    const variantIndex = input.dataset.stockVariant === undefined ? null : Number(input.dataset.stockVariant);
    pendingStock.set(stockKey(input.dataset.stockProduct, variantIndex), value);
    input.classList.add('changed');

    if (variantIndex !== null) {
      const product = bridge.getProducts().find(item => item.id === input.dataset.stockProduct);
      if (product) {
        const total = product.variants.reduce((sum, variant, index) => sum + (pendingStock.has(stockKey(product.id, index)) ? pendingStock.get(stockKey(product.id, index)) : Number(variant.stock || 0)), 0);
        pendingStock.set(stockKey(product.id), total);
      }
    }
    syncSavebar();
    renderInventoryRows();
  }

  function syncSavebar() {
    const count = [...pendingStock.keys()].filter(key => key.startsWith('p:') || key.startsWith('v:')).length;
    if ($('inventorySavebar')) $('inventorySavebar').classList.toggle('show', count > 0);
    if ($('inventoryPendingText')) $('inventoryPendingText').textContent = `${count} unsaved stock change${count === 1 ? '' : 's'}`;
  }

  function saveInventoryChanges() {
    if (!pendingStock.size) { notify('No inventory changes to save.'); return; }
    const now = new Date().toISOString();
    const next = bridge.getProducts().map(product => {
      let updated = {...product};
      if (Array.isArray(product.variants) && product.variants.length) {
        updated.variants = product.variants.map((variant, index) => pendingStock.has(stockKey(product.id, index)) ? {...variant, stock: pendingStock.get(stockKey(product.id, index))} : variant);
        if (product.variantsEnabled) updated.stock = updated.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
      } else if (pendingStock.has(stockKey(product.id))) {
        updated.stock = pendingStock.get(stockKey(product.id));
      }
      if (updated.stock !== product.stock || JSON.stringify(updated.variants || []) !== JSON.stringify(product.variants || [])) updated.inventoryUpdatedAt = now;
      return updated;
    });
    bridge.commit(next);
    pendingStock.clear();
    renderInventory();
    notify('Inventory stock saved locally.');
  }

  function restockLowInventory() {
    const products = bridge.getProducts();
    let changed = 0;
    products.forEach(product => {
      const threshold = productThreshold(product);
      if (product.variantsEnabled && Array.isArray(product.variants) && product.variants.length) {
        product.variants.forEach((variant, index) => {
          const stock = effectiveStock(product, index);
          if (stock <= threshold) { pendingStock.set(stockKey(product.id, index), stock + 10); changed++; }
        });
        if (product.variants.some((variant, index) => effectiveStock(product, index) <= threshold)) {
          const total = product.variants.reduce((sum, variant, index) => sum + (pendingStock.has(stockKey(product.id, index)) ? pendingStock.get(stockKey(product.id, index)) : Number(variant.stock || 0)), 0);
          pendingStock.set(stockKey(product.id), total);
        }
      } else {
        const stock = effectiveStock(product);
        if (stock <= threshold) { pendingStock.set(stockKey(product.id), stock + 10); changed++; }
      }
    });
    renderInventoryRows();
    syncSavebar();
    notify(changed ? `Prepared +10 units for ${changed} low-stock SKU${changed === 1 ? '' : 's'}. Save to apply.` : 'No low-stock SKUs need restocking.');
  }

  function loadOrders() {
    try {
      const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
      return Array.isArray(saved) && saved.length ? saved : structuredClone(starterOrders);
    } catch {
      return structuredClone(starterOrders);
    }
  }

  function saveOrders() {
    localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
  }

  function stageLabel(status) {
    return {new:'New',accepted:'Accepted',packed:'Packed',ready_to_ship:'Ready to ship',shipped:'Shipped',cancelled:'Cancelled'}[status] || status;
  }

  function nextAction(status) {
    return {
      new:{label:'Accept order',next:'accepted'},
      accepted:{label:'Mark packed',next:'packed'},
      packed:{label:'Ready to ship',next:'ready_to_ship'},
      ready_to_ship:{label:'Mark shipped',next:'shipped'}
    }[status] || null;
  }

  function upgradeOrdersView() {
    const view = $('view-orders');
    if (!view) return;
    const oldSearch = $('orderSearch');
    if (oldSearch) oldSearch.closest('.toolbar')?.remove();
    const oldList = $('ordersList');
    if (oldList) oldList.innerHTML = '';

    const panel = oldList?.closest('.panel');
    if (panel) {
      panel.innerHTML = `<div class="inventory-toolbar"><div class="fulfillment-tabs" id="fulfillmentTabs"><button class="fulfillment-tab active" data-order-filter="active">Active</button><button class="fulfillment-tab" data-order-filter="new">New</button><button class="fulfillment-tab" data-order-filter="processing">Processing</button><button class="fulfillment-tab" data-order-filter="shipped">Shipped</button><button class="fulfillment-tab" data-order-filter="all">All</button></div><div class="inventory-actions"><input class="inventory-search" id="fulfillmentSearch" type="search" placeholder="Search order, customer or SKU"><button class="ghost" id="resetFulfillment">Reset demo</button></div></div><div id="fulfillmentList"></div>`;
    }

    $('fulfillmentTabs')?.addEventListener('click', event => {
      const button = event.target.closest('[data-order-filter]');
      if (!button) return;
      orderFilter = button.dataset.orderFilter;
      document.querySelectorAll('[data-order-filter]').forEach(item => item.classList.toggle('active', item === button));
      renderFulfillment();
    });
    $('fulfillmentSearch')?.addEventListener('input', renderFulfillment);
    $('fulfillmentList')?.addEventListener('click', handleOrderAction);
    $('resetFulfillment')?.addEventListener('click', () => {
      if (!confirm('Reset demo order fulfilment statuses?')) return;
      orders = structuredClone(starterOrders); saveOrders(); renderFulfillment(); notify('Demo fulfilment orders restored.');
    });
  }

  function renderFulfillment() {
    const list = $('fulfillmentList');
    if (!list) return;
    const query = String($('fulfillmentSearch')?.value || '').trim().toLowerCase();
    const matchesFilter = order => {
      if (orderFilter === 'all') return true;
      if (orderFilter === 'active') return !['shipped','cancelled'].includes(order.status);
      if (orderFilter === 'processing') return ['accepted','packed','ready_to_ship'].includes(order.status);
      return order.status === orderFilter;
    };
    const rows = orders.filter(order => matchesFilter(order) && (!query || [order.id, order.customer, ...order.lines.flatMap(line => [line.sku, line.name])].some(value => String(value).toLowerCase().includes(query))));
    updateOrderMetrics();
    if (!rows.length) {
      list.innerHTML = '<div class="inventory-empty"><strong>No matching orders</strong>Try another fulfilment filter or search.</div>';
      return;
    }
    list.innerHTML = rows.map(order => {
      const action = nextAction(order.status);
      const stages = ['new','accepted','packed','ready_to_ship','shipped'];
      const currentIndex = stages.indexOf(order.status);
      return `<article class="fulfillment-card"><div><div class="fulfillment-id"><strong>${esc(order.id)}</strong><span class="order-stage ${esc(order.status)}">${esc(stageLabel(order.status))}</span></div><div class="fulfillment-meta">${esc(order.customer)} · ${formatDate(order.date)}</div><div class="fulfillment-lines">${order.lines.map(line => `<div class="fulfillment-line"><span>${line.qty}× ${esc(line.name)}</span><code>${esc(line.sku)}</code></div>`).join('')}</div>${order.status !== 'cancelled' ? `<div class="fulfillment-stepper">${stages.map((stage, index) => `<span class="fulfillment-step ${index < currentIndex ? 'done' : index === currentIndex ? 'current' : ''}">${esc(stageLabel(stage))}</span>`).join('')}</div>` : ''}</div><div class="fulfillment-side"><strong>${money(order.total)}</strong><div class="fulfillment-actions">${action ? `<button class="primary" data-order-next="${esc(order.id)}" data-next-status="${esc(action.next)}">${esc(action.label)}</button>` : ''}${['new','accepted'].includes(order.status) ? `<button class="small-btn danger-outline" data-order-cancel="${esc(order.id)}">Cancel</button>` : ''}</div></div></article>`;
    }).join('');
  }

  function updateOrderMetrics() {
    const active = orders.filter(order => !['shipped','cancelled'].includes(order.status));
    const newCount = orders.filter(order => order.status === 'new').length;
    const processing = orders.filter(order => ['accepted','packed','ready_to_ship'].includes(order.status)).length;
    const value = orders.filter(order => order.status !== 'cancelled').reduce((sum, order) => sum + Number(order.total || 0), 0);
    if ($('orderMetricTotal')) $('orderMetricTotal').textContent = orders.length;
    if ($('orderMetricNew')) $('orderMetricNew').textContent = newCount;
    if ($('orderMetricProcessing')) $('orderMetricProcessing').textContent = processing;
    if ($('orderMetricRevenue')) $('orderMetricRevenue').textContent = money(value);
    const totalCard = $('orderMetricTotal')?.closest('.metric-card')?.querySelector('small');
    if (totalCard) totalCard.textContent = `${active.length} currently active`;
  }

  function handleOrderAction(event) {
    const nextButton = event.target.closest('[data-order-next]');
    const cancelButton = event.target.closest('[data-order-cancel]');
    if (nextButton) {
      const order = orders.find(item => item.id === nextButton.dataset.orderNext);
      if (!order) return;
      order.status = nextButton.dataset.nextStatus;
      order.updatedAt = new Date().toISOString();
      saveOrders(); renderFulfillment(); notify(`${order.id}: ${stageLabel(order.status)}.`);
      return;
    }
    if (cancelButton) {
      const order = orders.find(item => item.id === cancelButton.dataset.orderCancel);
      if (!order || !confirm(`Cancel ${order.id}? This affects demo fulfilment data only.`)) return;
      order.status = 'cancelled'; order.updatedAt = new Date().toISOString();
      saveOrders(); renderFulfillment(); notify(`${order.id} cancelled in demo workflow.`);
    }
  }

  function notify(message) {
    if (bridge.notify) bridge.notify(message);
  }

  const originalCommit = bridge.commit;
  bridge.commit = next => { originalCommit(next); renderInventory(); };
})();

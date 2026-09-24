'use strict';

(() => {
  if (window.__sellerOperationsLiveBooted) return;
  window.__sellerOperationsLiveBooted = true;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const fmt = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}).format(date);
  };

  let snapshot = {orders: [], returns: [], summary: {}};
  let loaded = false;
  let loading = false;

  function client() { return window.supabaseClient; }
  function notify(message) { window.SellerCatalogBridge?.notify?.(message); }
  function itemLabel(item) {
    const qty = Math.max(1, Number(item?.qty || 1));
    return `${qty} × ${item?.name || item?.sku || 'Product'}`;
  }
  function stateLabel(value) {
    return String(value || 'pending').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  function liveCopy() {
    const orders = $('view-orders');
    const payments = $('view-payments');
    const returns = $('view-returns');
    const orderDesc = orders?.querySelector('.page-head p:last-child');
    const paymentDesc = payments?.querySelector('.page-head p:last-child');
    const returnDesc = returns?.querySelector('.page-head p:last-child');
    if (orderDesc) orderDesc.textContent = 'Orders containing products approved under your seller account.';
    if (paymentDesc) paymentDesc.textContent = 'Seller sales collection status from live customer orders. Payout settlement is shown only after a payout ledger is connected.';
    if (returnDesc) returnDesc.textContent = 'Return requests for items belonging to your approved seller products.';
    const orderNotice = orders?.querySelector('.notice.info');
    if (orderNotice) orderNotice.innerHTML = '<div class="notice-icon">i</div><div><strong>Live seller order feed</strong><p>Only order lines mapped to your approved seller products are shown. Customer data is limited to fulfilment information for those orders.</p></div>';
    payments?.querySelectorAll('small').forEach(node => {
      if (/ui preview|not configured/i.test(node.textContent || '')) node.textContent = 'Live order-derived value';
    });
    returns?.querySelectorAll('small').forEach(node => {
      if (/ui preview|not available/i.test(node.textContent || '')) node.textContent = 'Live return data';
    });
  }

  function renderOrders() {
    const rows = Array.isArray(snapshot.orders) ? snapshot.orders : [];
    const active = rows.filter(row => !['cancelled', 'cod_cancelled', 'failed'].includes(String(row.status || '').toLowerCase()));
    const processing = active.filter(row => !['delivered', 'cancelled'].includes(String(row.fulfillment_status || '').toLowerCase()));
    if ($('orderMetricTotal')) $('orderMetricTotal').textContent = rows.length.toLocaleString('en-IN');
    if ($('orderMetricNew')) $('orderMetricNew').textContent = active.filter(row => String(row.fulfillment_status || '').toLowerCase() === 'ordered').length.toLocaleString('en-IN');
    if ($('orderMetricProcessing')) $('orderMetricProcessing').textContent = processing.length.toLocaleString('en-IN');
    if ($('orderMetricRevenue')) $('orderMetricRevenue').textContent = money(snapshot.summary?.gross_sales || 0);

    const list = $('ordersList');
    if (!list) return;
    const query = String($('orderSearch')?.value || '').trim().toLowerCase();
    const filtered = rows.filter(row => {
      if (!query) return true;
      const haystack = [row.display_order_id, row.customer_name, row.status, row.fulfillment_status, ...(row.items || []).flatMap(item => [item.name, item.sku])].join(' ').toLowerCase();
      return haystack.includes(query);
    });
    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state"><div>□</div><h3>${rows.length ? 'No matching orders' : 'No seller orders yet'}</h3><p>${rows.length ? 'Try another search.' : 'Orders will appear here when customers buy products approved under this seller account.'}</p></div>`;
      return;
    }
    list.innerHTML = filtered.map(row => `
      <article class="data-row" style="padding:16px 18px;border-bottom:1px solid #eef0f4;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px">
        <div>
          <strong style="font-size:12px">${esc(row.display_order_id || `Order ${row.id}`)}</strong>
          <div style="font-size:10px;color:#7d8696;margin-top:4px">${esc(fmt(row.created_at))}${row.customer_name ? ` · ${esc(row.customer_name)}` : ''}</div>
          <div style="font-size:10px;color:#465063;margin-top:8px">${(row.items || []).map(item => esc(itemLabel(item))).join('<br>')}</div>
        </div>
        <div style="text-align:right">
          <strong style="font-size:12px">${esc(money(row.seller_total))}</strong>
          <div style="font-size:9px;margin-top:6px">${esc(stateLabel(row.fulfillment_status))}</div>
          <div style="font-size:9px;color:#7d8696;margin-top:3px">${esc(stateLabel(row.payment_method))}</div>
        </div>
      </article>`).join('');
  }

  function renderPayments() {
    const paid = Number(snapshot.summary?.paid_sales || 0);
    const pending = Number(snapshot.summary?.pending_sales || 0);
    if ($('paymentPaid')) $('paymentPaid').textContent = money(paid);
    if ($('paymentPending')) $('paymentPending').textContent = money(pending);
    const list = $('paymentsList');
    if (!list) return;
    const orders = (snapshot.orders || []).filter(row => !['cancelled', 'cod_cancelled', 'failed'].includes(String(row.status || '').toLowerCase()));
    if (!orders.length) {
      list.innerHTML = '<div class="empty-state"><div>₹</div><h3>No seller sales yet</h3><p>Verified and pending customer payments for seller-owned order lines will appear here.</p></div>';
      return;
    }
    list.innerHTML = orders.map(row => `
      <article class="data-row" style="padding:16px 18px;border-bottom:1px solid #eef0f4;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px">
        <div><strong style="font-size:12px">${esc(row.display_order_id || `Order ${row.id}`)}</strong><div style="font-size:10px;color:#7d8696;margin-top:4px">${esc(fmt(row.created_at))} · ${esc(stateLabel(row.payment_method))}</div></div>
        <div style="text-align:right"><strong style="font-size:12px">${esc(money(row.seller_total))}</strong><div style="font-size:9px;margin-top:5px;color:${row.payment_verified_at ? '#128a53' : '#94610b'}">${row.payment_verified_at ? 'Payment verified' : 'Payment pending/unverified'}</div></div>
      </article>`).join('');
  }

  function renderReturns() {
    const rows = Array.isArray(snapshot.returns) ? snapshot.returns : [];
    const closedStates = new Set(['resolved', 'completed', 'refunded', 'rejected', 'closed']);
    const closed = rows.filter(row => closedStates.has(String(row.status || '').toLowerCase())).length;
    if ($('returnOpen')) $('returnOpen').textContent = Math.max(0, rows.length - closed).toLocaleString('en-IN');
    if ($('returnClosed')) $('returnClosed').textContent = closed.toLocaleString('en-IN');
    const list = $('returnsList');
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = '<div class="empty-state"><div>↩</div><h3>No seller return requests</h3><p>Return requests will appear only when the requested order item belongs to this seller.</p></div>';
      return;
    }
    list.innerHTML = rows.map(row => `
      <article class="data-row" style="padding:16px 18px;border-bottom:1px solid #eef0f4;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px">
        <div><strong style="font-size:12px">${esc(itemLabel(row.item))}</strong><div style="font-size:10px;color:#7d8696;margin-top:4px">Order ${esc(row.order_id)} · ${esc(fmt(row.created_at))}</div><div style="font-size:10px;color:#465063;margin-top:7px">${esc(row.reason || 'No reason provided')}</div></div>
        <div style="text-align:right"><strong style="font-size:10px">${esc(stateLabel(row.request_type))}</strong><div style="font-size:9px;margin-top:5px">${esc(stateLabel(row.status))}</div>${row.refund_amount != null ? `<div style="font-size:9px;color:#7d8696;margin-top:4px">${esc(money(row.refund_amount))}</div>` : ''}</div>
      </article>`).join('');
  }

  function render() {
    liveCopy();
    renderOrders();
    renderPayments();
    renderReturns();
  }

  async function load() {
    if (loading) return;
    const sb = client();
    if (!sb) return;
    loading = true;
    try {
      const {data: sessionData, error: sessionError} = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session?.user) return;
      const {data, error} = await sb.rpc('get_seller_operations');
      if (error) throw error;
      snapshot = data && typeof data === 'object' ? data : {orders: [], returns: [], summary: {}};
      loaded = true;
      render();
    } catch (error) {
      console.error('Seller operations load failed', error);
      if (!loaded) notify(error?.message || 'Could not load seller orders.');
    } finally {
      loading = false;
    }
  }

  document.addEventListener('input', event => {
    if (event.target?.id === 'orderSearch') renderOrders();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  window.addEventListener('seller:operations:refresh', load);
  window.SellerOperationsLive = {load, refresh: load, snapshot: () => snapshot};

  const boot = () => {
    render();
    let attempts = 0;
    const timer = setInterval(() => {
      if (client()) {
        clearInterval(timer);
        load();
      } else if (++attempts > 80) clearInterval(timer);
    }, 100);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();

'use strict';

(() => {
  const bridge = window.SellerCatalogBridge;
  if (!bridge) return;

  const SESSION_KEY = 'ff_seller_session_v1';
  const QA_STORE = 'ff_seller_qa_last_v1';
  const $ = id => document.getElementById(id);

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function sellerKey() {
    const session = readSession();
    return session?.sellerId || session?.email || 'seller';
  }

  function injectFixStyles() {
    if ($('seller-final-qa-fixes-style')) return;
    const style = document.createElement('style');
    style.id = 'seller-final-qa-fixes-style';
    style.textContent = `
      .sidebar{overflow:hidden}
      .sidebar .brand{flex:0 0 auto}
      .sidebar .nav{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;align-content:start;padding-right:4px;scrollbar-width:thin;scrollbar-color:#3a455a transparent}
      .sidebar .nav::-webkit-scrollbar{width:6px}.sidebar .nav::-webkit-scrollbar-thumb{background:#3a455a;border-radius:999px}.sidebar .nav::-webkit-scrollbar-track{background:transparent}
      .sidebar .sidebar-foot{flex:0 0 auto;padding-top:10px}
      [data-recon-match][disabled]{opacity:.58;cursor:not-allowed;filter:none!important}
      @media(max-width:760px){.sidebar{overflow:visible}.sidebar .nav{overflow:visible;min-height:auto;padding-right:0}.sidebar .sidebar-foot{padding-top:0}}
    `;
    document.head.appendChild(style);
  }

  function wrapNotifyForSameTabRefresh() {
    if (bridge.__qaSameTabRefreshWrapped) return;
    const originalNotify = bridge.notify;
    bridge.notify = message => {
      const result = originalNotify?.(message);
      queueMicrotask(() => window.dispatchEvent(new Event('storage')));
      return result;
    };
    bridge.__qaSameTabRefreshWrapped = true;
  }

  function installShortcutGuard() {
    if (window.__sellerQaShortcutGuard) return;
    window.__sellerQaShortcutGuard = true;
    document.addEventListener('keydown', event => {
      const quickSwitch = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k';
      if (!quickSwitch) return;
      const button = $('quickSwitchButton');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      button.click();
    }, true);
  }

  function syncInventoryPendingCount() {
    const text = $('inventoryPendingText');
    const savebar = $('inventorySavebar');
    if (!text || !savebar) return;
    const count = document.querySelectorAll('#inventoryRows .stock-input.changed:not([readonly])').length;
    text.textContent = `${count} unsaved stock change${count === 1 ? '' : 's'}`;
    savebar.classList.toggle('show', count > 0);
  }

  function installInventoryObserver() {
    const rows = $('inventoryRows');
    if (!rows || rows.dataset.qaPendingObserver === 'true') return false;
    rows.dataset.qaPendingObserver = 'true';
    const observer = new MutationObserver(() => queueMicrotask(syncInventoryPendingCount));
    observer.observe(rows, {childList:true, subtree:true, attributes:true, attributeFilter:['class','value']});
    rows.addEventListener('input', () => queueMicrotask(syncInventoryPendingCount));
    document.addEventListener('click', event => {
      if (event.target.closest('#inventorySave,#inventorySaveTop,#inventoryDiscard,#inventoryRestockLow')) setTimeout(syncInventoryPendingCount, 0);
    });
    syncInventoryPendingCount();
    return true;
  }

  function pendingPayoutRow(row) {
    return [...row.querySelectorAll('.cx-status')].some(node => node.textContent.trim().toLowerCase() === 'pending');
  }

  function guardReconciliation() {
    document.querySelectorAll('#reconList .recon-row').forEach(row => {
      const button = row.querySelector('[data-recon-match]');
      if (!button) return;
      const pending = pendingPayoutRow(row);
      button.disabled = pending;
      if (pending) {
        button.textContent = 'Await payout';
        button.title = 'A pending payout cannot be reconciled until it is recorded as paid.';
      }
    });
  }

  function installReconciliationGuard() {
    const list = $('reconList');
    if (!list || list.dataset.qaReconGuard === 'true') return false;
    list.dataset.qaReconGuard = 'true';
    const observer = new MutationObserver(() => queueMicrotask(guardReconciliation));
    observer.observe(list, {childList:true, subtree:true});
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-recon-match]');
      if (!button) return;
      const row = button.closest('.recon-row');
      if (!row || !pendingPayoutRow(row)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      bridge.notify?.('Pending payout cannot be reconciled. Record a paid settlement first.');
    }, true);
    guardReconciliation();
    return true;
  }

  function runStructuralAudit() {
    const idCounts = new Map();
    document.querySelectorAll('[id]').forEach(node => idCounts.set(node.id, (idCounts.get(node.id) || 0) + 1));
    const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({id, count}));
    const missingViews = [...document.querySelectorAll('.nav-item[data-view]')]
      .map(button => button.dataset.view)
      .filter(view => !document.getElementById(`view-${view}`));
    const activeViews = [...document.querySelectorAll('.content.view.active')].map(node => node.id);
    const coreIds = ['view-overview','view-products','view-orders','view-payments','view-returns','productDrawer','toast'];
    const missingCore = coreIds.filter(id => !$(id));
    const report = {
      checkedAt: new Date().toISOString(),
      duplicateIds,
      missingViews: [...new Set(missingViews)],
      activeViewCount: activeViews.length,
      activeViews,
      missingCore,
      ok: duplicateIds.length === 0 && missingViews.length === 0 && activeViews.length === 1 && missingCore.length === 0
    };
    let root = {};
    try { root = JSON.parse(localStorage.getItem(QA_STORE) || '{}') || {}; } catch {}
    root[sellerKey()] = report;
    localStorage.setItem(QA_STORE, JSON.stringify(root));
    if (!report.ok) console.warn('[Seller QA] Structural issues detected', report);
    else console.info('[Seller QA] Structural audit passed', report);
  }

  injectFixStyles();
  wrapNotifyForSameTabRefresh();
  installShortcutGuard();

  const timer = setInterval(() => {
    const inventoryReady = installInventoryObserver() || Boolean($('inventoryRows'));
    const reconReady = installReconciliationGuard() || Boolean($('reconList'));
    if (inventoryReady && reconReady) clearInterval(timer);
  }, 120);
  setTimeout(() => clearInterval(timer), 8000);

  setTimeout(runStructuralAudit, 1800);
  setTimeout(runStructuralAudit, 4200);
})();

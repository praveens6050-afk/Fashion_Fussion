'use strict';

(() => {
  const bridge = window.SellerCatalogBridge;
  if (!bridge) return;

  function threshold(product) {
    const value = Number(product.lowStockThreshold);
    return Number.isInteger(value) && value >= 0 ? value : 5;
  }

  function install() {
    const original = document.getElementById('inventoryRestockLow');
    if (!original || original.dataset.fixedRestock === 'true') return false;
    const button = original.cloneNode(true);
    button.dataset.fixedRestock = 'true';
    button.textContent = 'Restock low +10';
    original.replaceWith(button);
    button.addEventListener('click', () => {
      const now = new Date().toISOString();
      let changed = 0;
      const next = bridge.getProducts().map(product => {
        const limit = threshold(product);
        if (product.variantsEnabled && Array.isArray(product.variants) && product.variants.length) {
          let productChanged = false;
          const variants = product.variants.map(variant => {
            const stock = Number(variant.stock || 0);
            if (stock <= limit) {
              changed += 1;
              productChanged = true;
              return {...variant, stock: stock + 10};
            }
            return variant;
          });
          if (!productChanged) return product;
          return {...product, variants, stock: variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0), inventoryUpdatedAt: now};
        }
        const stock = Number(product.stock || 0);
        if (stock > limit) return product;
        changed += 1;
        return {...product, stock: stock + 10, inventoryUpdatedAt: now};
      });
      if (!changed) {
        bridge.notify('No low-stock SKUs need restocking.');
        return;
      }
      bridge.commit(next);
      bridge.notify(`Added 10 units to ${changed} low-stock SKU${changed === 1 ? '' : 's'} and saved inventory.`);
    });
    return true;
  }

  if (!install()) {
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document.body, {childList:true, subtree:true});
    setTimeout(() => observer.disconnect(), 10000);
  }
})();

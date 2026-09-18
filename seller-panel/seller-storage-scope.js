'use strict';

(() => {
  const SESSION_KEY = 'ff_seller_session_v1';
  const LEGACY_CLAIM_KEY = 'ff_seller_legacy_scope_claim_v1';
  const SCOPED_KEYS = new Set([
    'ff_seller_panel_demo_v1',
    'ff_seller_fulfillment_orders_v1',
    'ff_seller_shipping_meta_v1',
    'ff_seller_notification_reads_v1'
  ]);

  const rawGet = Storage.prototype.getItem;
  const rawSet = Storage.prototype.setItem;
  const rawRemove = Storage.prototype.removeItem;

  function readSessionRaw() {
    try {
      return JSON.parse(
        rawGet.call(localStorage, SESSION_KEY) ||
        rawGet.call(sessionStorage, SESSION_KEY) ||
        'null'
      );
    } catch {
      return null;
    }
  }

  const session = readSessionRaw();
  if (!session) return;
  const sellerKey = String(session.sellerId || session.email || 'seller').replace(/[^A-Za-z0-9@._-]/g, '_');
  const physicalKey = key => `${key}::${sellerKey}`;

  let legacyOwner = rawGet.call(localStorage, LEGACY_CLAIM_KEY);
  if (!legacyOwner) {
    legacyOwner = sellerKey;
    rawSet.call(localStorage, LEGACY_CLAIM_KEY, sellerKey);
  }
  const canClaimLegacy = legacyOwner === sellerKey;

  // Preserve the pre-scoping shared demo state for only the first seller that
  // opens this build. Other/new sellers get independent fresh starter data.
  SCOPED_KEYS.forEach(key => {
    const scoped = physicalKey(key);
    if (rawGet.call(localStorage, scoped) !== null || !canClaimLegacy) return;
    const legacy = rawGet.call(localStorage, key);
    if (legacy !== null) rawSet.call(localStorage, scoped, legacy);
  });

  if (!window.__sellerStorageScopeInstalled) {
    Storage.prototype.getItem = function(key) {
      if (this === localStorage && SCOPED_KEYS.has(String(key))) {
        return rawGet.call(this, physicalKey(String(key)));
      }
      return rawGet.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage && SCOPED_KEYS.has(String(key))) {
        return rawSet.call(this, physicalKey(String(key)), value);
      }
      return rawSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      if (this === localStorage && SCOPED_KEYS.has(String(key))) {
        return rawRemove.call(this, physicalKey(String(key)));
      }
      return rawRemove.call(this, key);
    };
    window.__sellerStorageScopeInstalled = true;
  }

  // app.js loads before portal.js. Replace its shared in-memory catalog with
  // this seller's scoped catalog; new sellers receive the starter catalog.
  try {
    const scopedProducts = JSON.parse(localStorage.getItem('ff_seller_panel_demo_v1') || 'null');
    if (Array.isArray(scopedProducts) && typeof products !== 'undefined') {
      products = scopedProducts;
    } else if (typeof starterProducts !== 'undefined' && typeof products !== 'undefined') {
      products = structuredClone(starterProducts);
      if (typeof persist === 'function') persist();
    }
    if (typeof renderAll === 'function') renderAll();
    if (typeof syncTabs === 'function') syncTabs();
  } catch (error) {
    console.warn('[Seller storage scope] Catalog migration skipped', error);
  }
})();

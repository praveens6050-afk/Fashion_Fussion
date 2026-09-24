'use strict';

(() => {
  const bridge = window.SellerCatalogBridge;
  if (!bridge || !document.getElementById('productForm')) return;

  const $ = id => document.getElementById(id);
  let variantRows = [];

  const css = `
    .drawer.catalog-advanced{width:min(780px,96vw)}
    .advanced-section{position:relative}
    .advanced-section .section-kicker{display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;padding:4px 8px;border-radius:999px;background:#eef4ff;color:#315fbd;font-size:10px;font-weight:800;letter-spacing:.4px}
    .field-help{margin:-7px 0 12px;color:#8a93a2;font-size:10px;line-height:1.45}
    .check-card{display:flex;align-items:flex-start;gap:10px;border:1px solid #dfe3ea;border-radius:11px;padding:11px 12px;margin-bottom:12px;background:#fafbfc}
    .check-card input{width:auto!important;margin:3px 0 0;accent-color:#2f6fed}
    .check-card strong,.check-card span{display:block}.check-card strong{font-size:12px}.check-card span{margin-top:2px;color:#7b8494;font-size:10px;line-height:1.4}
    .advanced-hidden{display:none!important}
    .advanced-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .variant-builder{border:1px solid #e4e8ef;border-radius:12px;background:#fafbfc;padding:12px;margin-top:8px}
    .variant-builder-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
    .variant-builder-head strong{font-size:12px}.variant-builder-head span{display:block;color:#8b93a3;font-size:10px;margin-top:2px}
    .variant-table-wrap{overflow:auto;border:1px solid #e6e9ef;border-radius:10px;background:#fff;margin-top:10px}
    .variant-table{width:100%;min-width:620px;border-collapse:collapse}
    .variant-table th,.variant-table td{padding:9px 10px;border-bottom:1px solid #eef0f4;text-align:left}
    .variant-table th{font-size:9px;letter-spacing:.6px;color:#8992a1;background:#fafbfc}.variant-table td{font-size:11px}
    .variant-table input{margin:0!important;padding:8px!important;border-radius:7px!important;font-size:11px!important}
    .variant-empty{padding:16px;text-align:center;color:#8b93a3;font-size:11px}
    .stock-lock{background:#f4f6f9!important;color:#6b7280!important}
    .media-preview{display:flex;gap:9px;flex-wrap:wrap;margin-top:10px}
    .media-preview-item{width:70px;height:70px;border:1px solid #dfe3ea;border-radius:10px;overflow:hidden;background:#f4f6f9;display:grid;place-items:center;color:#8b93a3;font-size:9px;font-weight:700;position:relative}
    .media-preview-item img{width:100%;height:100%;object-fit:cover}.media-preview-item b{position:absolute;left:4px;bottom:4px;background:rgba(17,24,39,.78);color:#fff;padding:2px 4px;border-radius:4px;font-size:8px}
    .bulk-summary{display:flex;gap:8px;align-items:center;padding:9px 10px;border-radius:9px;background:#f2f7ff;color:#3b5d93;font-size:10px;margin-top:-3px;margin-bottom:12px}
    .form-section input[readonly]{cursor:not-allowed}
    @media(max-width:760px){.advanced-grid-3{grid-template-columns:1fr}.drawer.catalog-advanced{width:100vw}}
  `;
  const style = document.createElement('style');
  style.id = 'seller-catalog-enhancements-style';
  style.textContent = css;
  document.head.appendChild(style);
  document.getElementById('productDrawer').classList.add('catalog-advanced');

  function section(html) {
    const wrap = document.createElement('div');
    wrap.className = 'form-section advanced-section';
    wrap.innerHTML = html;
    return wrap;
  }

  const form = $('productForm');
  const basicSection = $('name').closest('.form-section');
  const pricingSection = $('price').closest('.form-section');
  const mediaSection = $('image').closest('.form-section');

  const identitySection = section(`
    <span class="section-kicker">CATALOG IDENTITY</span>
    <h3>Brand & compliance</h3><p>Extra catalog fields prepared for marketplace review and future tax/shipping integration.</p>
    <div class="form-grid"><label>Brand<input id="brand" maxlength="80" required placeholder="e.g. Fashion_Fussion"></label><label>Model / style code<input id="modelCode" maxlength="60" placeholder="e.g. OVERSIZE-2401"></label></div>
    <div class="form-grid"><label>HSN code (optional)<input id="hsn" maxlength="8" inputmode="numeric" placeholder="e.g. 610910"></label><label>Country of origin<input id="countryOrigin" maxlength="80" required value="India"></label></div>
  `);
  basicSection.insertAdjacentElement('afterend', identitySection);

  const bulkSection = section(`
    <span class="section-kicker">B2B / BULK</span>
    <h3>Business pricing</h3><p>Keep single-unit retail pricing and optionally offer a lower price to business buyers above a minimum quantity.</p>
    <label class="check-card"><input id="bulkEnabled" type="checkbox"><div><strong>Enable bulk price</strong><span>Business buyers can qualify for a separate per-unit price when MOQ is reached.</span></div></label>
    <div id="bulkFields" class="advanced-hidden">
      <div class="form-grid"><label>Minimum bulk quantity<input id="bulkMinQty" type="number" min="2" step="1" value="10"></label><label>Bulk price / unit (₹)<input id="bulkPrice" type="number" min="1" step="0.01"></label></div>
      <div id="bulkSummary" class="bulk-summary">Bulk pricing is enabled.</div>
    </div>
  `);
  pricingSection.insertAdjacentElement('afterend', bulkSection);

  const variantsSection = section(`
    <span class="section-kicker">VARIANTS</span>
    <h3>Size, color & variant inventory</h3><p>Create SKU-level stock for size/color combinations. Total product stock is calculated automatically from variants.</p>
    <label class="check-card"><input id="variantsEnabled" type="checkbox"><div><strong>This product has variants</strong><span>Use for apparel, footwear, colors, pack sizes or similar options.</span></div></label>
    <div id="variantBuilder" class="variant-builder advanced-hidden">
      <div class="variant-builder-head"><div><strong>Variant generator</strong><span>Comma-separate values, then generate the matrix.</span></div><button type="button" class="small-btn" id="generateVariants">Generate variants</button></div>
      <div class="form-grid"><label>Sizes / options<input id="variantSizes" maxlength="180" placeholder="S, M, L, XL"></label><label>Colors / styles<input id="variantColors" maxlength="180" placeholder="Black, White, Navy"></label></div>
      <div class="variant-table-wrap"><div id="variantRows"></div></div>
    </div>
  `);
  bulkSection.insertAdjacentElement('afterend', variantsSection);

  const shippingSection = section(`
    <span class="section-kicker">FULFILMENT</span>
    <h3>Shipping & inventory controls</h3><p>Package details are stored locally now and are ready for later logistics-rate and serviceability integration.</p>
    <div class="form-grid"><label>Package weight (g)<input id="weightGrams" type="number" min="1" step="1" required value="500"></label><label>Dispatch time (days)<input id="dispatchDays" type="number" min="1" max="30" step="1" required value="2"></label></div>
    <div class="advanced-grid-3"><label>Length (cm)<input id="lengthCm" type="number" min="0.1" step="0.1" required value="30"></label><label>Width (cm)<input id="widthCm" type="number" min="0.1" step="0.1" required value="25"></label><label>Height (cm)<input id="heightCm" type="number" min="0.1" step="0.1" required value="5"></label></div>
    <div class="form-grid"><label>Low-stock alert at<input id="lowStockThreshold" type="number" min="0" step="1" value="5"></label><label>Return window (days)<input id="returnDays" type="number" min="0" max="30" step="1" value="7"></label></div>
  `);
  variantsSection.insertAdjacentElement('afterend', shippingSection);

  const mediaExtra = document.createElement('div');
  mediaExtra.innerHTML = `
    <label>Additional image URLs (one per line, max 5)<textarea id="additionalImages" rows="4" maxlength="5000" placeholder="https://example.com/back.jpg\nhttps://example.com/detail.jpg"></textarea></label>
    <p class="field-help">The existing image URL above remains the primary image. Up to 6 total images are stored in this prototype.</p>
    <div id="mediaPreview" class="media-preview"></div>
  `;
  mediaSection.appendChild(mediaExtra);

  function splitValues(value) {
    return [...new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean))].slice(0, 20);
  }
  function skuPart(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12);
  }
  function validUrl(value) {
    try { const parsed = new URL(value); return parsed.protocol === 'http:' || parsed.protocol === 'https:'; } catch { return false; }
  }
  function imageList() {
    const primary = $('image').value.trim();
    const additional = String($('additionalImages').value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    return [primary, ...additional].filter(Boolean);
  }
  function renderMediaPreview() {
    const images = imageList().slice(0, 6);
    $('mediaPreview').innerHTML = images.map((src, index) => `<div class="media-preview-item">${validUrl(src) ? `<img src="${escapeHtml(src)}" alt="">` : 'INVALID'}${index === 0 ? '<b>PRIMARY</b>' : ''}</div>`).join('');
    $('mediaPreview').querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.parentElement.textContent = 'IMAGE ERROR'; }, { once: true }));
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function toggleBulk() {
    $('bulkFields').classList.toggle('advanced-hidden', !$('bulkEnabled').checked);
    updateBulkSummary();
  }
  function updateBulkSummary() {
    if (!$('bulkEnabled').checked) return;
    const qty = Number($('bulkMinQty').value || 0);
    const price = Number($('bulkPrice').value || 0);
    $('bulkSummary').textContent = qty >= 2 && price > 0 ? `Business price ₹${price.toLocaleString('en-IN')} per unit from ${qty} units.` : 'Enter MOQ and bulk unit price.';
  }
  function toggleVariants() {
    const enabled = $('variantsEnabled').checked;
    $('variantBuilder').classList.toggle('advanced-hidden', !enabled);
    $('stock').readOnly = enabled;
    $('stock').classList.toggle('stock-lock', enabled);
    if (!enabled) variantRows = [];
    renderVariantRows();
  }
  function collectRenderedVariants() {
    return [...document.querySelectorAll('#variantRows [data-variant-row]')].map(row => ({
      size: row.dataset.size || '', color: row.dataset.color || '',
      sku: row.querySelector('[data-v-sku]').value.trim().toUpperCase(),
      stock: Number(row.querySelector('[data-v-stock]').value),
      priceOverride: row.querySelector('[data-v-price]').value === '' ? null : Number(row.querySelector('[data-v-price]').value)
    }));
  }
  function recalcVariantStock() {
    if (!$('variantsEnabled').checked) return;
    const rows = collectRenderedVariants();
    const total = rows.reduce((sum, row) => sum + (Number.isInteger(row.stock) && row.stock > 0 ? row.stock : 0), 0);
    $('stock').value = String(total);
  }
  function renderVariantRows() {
    if (!$('variantsEnabled').checked) { $('variantRows').innerHTML = '<div class="variant-empty">Enable variants to create SKU-level inventory.</div>'; return; }
    if (!variantRows.length) { $('variantRows').innerHTML = '<div class="variant-empty">Add size/color values and click “Generate variants”.</div>'; $('stock').value = '0'; return; }
    $('variantRows').innerHTML = `<table class="variant-table"><thead><tr><th>SIZE / OPTION</th><th>COLOR / STYLE</th><th>VARIANT SKU</th><th>STOCK</th><th>PRICE OVERRIDE</th></tr></thead><tbody>${variantRows.map((row, index) => `<tr data-variant-row data-size="${escapeHtml(row.size)}" data-color="${escapeHtml(row.color)}"><td>${escapeHtml(row.size || '—')}</td><td>${escapeHtml(row.color || '—')}</td><td><input data-v-sku maxlength="60" value="${escapeHtml(row.sku)}" aria-label="Variant ${index + 1} SKU"></td><td><input data-v-stock type="number" min="0" step="1" value="${Number.isInteger(row.stock) ? row.stock : 0}" aria-label="Variant ${index + 1} stock"></td><td><input data-v-price type="number" min="1" step="0.01" value="${row.priceOverride ?? ''}" placeholder="Base price" aria-label="Variant ${index + 1} price override"></td></tr>`).join('')}</tbody></table>`;
    $('variantRows').querySelectorAll('input').forEach(input => input.addEventListener('input', recalcVariantStock));
    recalcVariantStock();
  }
  function generateVariants() {
    const oldRows = collectRenderedVariants();
    const oldMap = new Map(oldRows.map(row => [`${row.size.toLowerCase()}|${row.color.toLowerCase()}`, row]));
    const sizes = splitValues($('variantSizes').value);
    const colors = splitValues($('variantColors').value);
    if (!sizes.length && !colors.length) { bridge.notify('Add at least one size/option or color/style.'); return; }
    const sizeList = sizes.length ? sizes : [''];
    const colorList = colors.length ? colors : [''];
    if (sizeList.length * colorList.length > 50) { bridge.notify('Maximum 50 variants are allowed in this prototype.'); return; }
    const base = skuPart($('sku').value) || 'SKU';
    variantRows = [];
    sizeList.forEach(size => colorList.forEach(color => {
      const key = `${size.toLowerCase()}|${color.toLowerCase()}`;
      const old = oldMap.get(key);
      const suffix = [skuPart(size), skuPart(color)].filter(Boolean).join('-');
      variantRows.push({ size, color, sku: old?.sku || `${base}${suffix ? '-' + suffix : ''}`, stock: Number.isInteger(old?.stock) ? old.stock : 0, priceOverride: old?.priceOverride ?? null });
    }));
    renderVariantRows();
  }
  function normalizeProduct(product) {
    return {
      brand: product?.brand || '', modelCode: product?.modelCode || '', hsn: product?.hsn || '', countryOrigin: product?.countryOrigin || 'India',
      bulkEnabled: Boolean(product?.bulkEnabled), bulkMinQty: product?.bulkMinQty ?? 10, bulkPrice: product?.bulkPrice ?? '',
      variantsEnabled: Boolean(product?.variantsEnabled), variantSizes: product?.variantSizes || '', variantColors: product?.variantColors || '', variants: Array.isArray(product?.variants) ? product.variants : [],
      weightGrams: product?.weightGrams ?? 500, lengthCm: product?.lengthCm ?? 30, widthCm: product?.widthCm ?? 25, heightCm: product?.heightCm ?? 5,
      dispatchDays: product?.dispatchDays ?? 2, lowStockThreshold: product?.lowStockThreshold ?? 5, returnDays: product?.returnDays ?? 7,
      images: Array.isArray(product?.images) && product.images.length ? product.images : (product?.image ? [product.image] : [])
    };
  }
  function fillAdvanced(product) {
    const data = normalizeProduct(product);
    $('brand').value = data.brand;
    $('modelCode').value = data.modelCode;
    $('hsn').value = data.hsn;
    $('countryOrigin').value = data.countryOrigin;
    $('bulkEnabled').checked = data.bulkEnabled;
    $('bulkMinQty').value = data.bulkMinQty;
    $('bulkPrice').value = data.bulkPrice;
    $('variantsEnabled').checked = data.variantsEnabled;
    $('variantSizes').value = data.variantSizes;
    $('variantColors').value = data.variantColors;
    variantRows = data.variants.map(v => ({...v}));
    $('weightGrams').value = data.weightGrams;
    $('lengthCm').value = data.lengthCm;
    $('widthCm').value = data.widthCm;
    $('heightCm').value = data.heightCm;
    $('dispatchDays').value = data.dispatchDays;
    $('lowStockThreshold').value = data.lowStockThreshold;
    $('returnDays').value = data.returnDays;
    const images = data.images.slice(0, 6);
    if (images.length && !$('image').value) $('image').value = images[0];
    $('additionalImages').value = images.slice(1).join('\n');
    toggleBulk();
    toggleVariants();
    renderMediaPreview();
  }
  function advancedPayload(base) {
    const variants = $('variantsEnabled').checked ? collectRenderedVariants() : [];
    const images = imageList();
    return {
      ...base,
      brand: $('brand').value.trim(), modelCode: $('modelCode').value.trim(), hsn: $('hsn').value.trim(), countryOrigin: $('countryOrigin').value.trim(),
      bulkEnabled: $('bulkEnabled').checked, bulkMinQty: $('bulkEnabled').checked ? Number($('bulkMinQty').value) : null, bulkPrice: $('bulkEnabled').checked ? Number($('bulkPrice').value) : null,
      variantsEnabled: $('variantsEnabled').checked, variantSizes: $('variantSizes').value.trim(), variantColors: $('variantColors').value.trim(), variants,
      weightGrams: Number($('weightGrams').value), lengthCm: Number($('lengthCm').value), widthCm: Number($('widthCm').value), heightCm: Number($('heightCm').value),
      dispatchDays: Number($('dispatchDays').value), lowStockThreshold: Number($('lowStockThreshold').value), returnDays: Number($('returnDays').value),
      images, image: images[0] || ''
    };
  }
  function basePayload() {
    return {
      name: $('name').value.trim(), category: $('category').value.trim(), sku: $('sku').value.trim().toUpperCase(), description: $('description').value.trim(),
      price: Number($('price').value), mrp: Number($('mrp').value), stock: Number($('stock').value), gst: Number($('gst').value), image: $('image').value.trim()
    };
  }
  function validate(data, id, allProducts) {
    if (!data.name || !data.category || !data.sku || !data.description || !data.brand || !data.countryOrigin) return 'Complete all required product and brand information.';
    if (!Number.isFinite(data.price) || data.price <= 0 || !Number.isFinite(data.mrp) || data.mrp <= 0) return 'Enter valid price and MRP values.';
    if (data.mrp < data.price) return 'MRP cannot be lower than selling price.';
    if (!Number.isInteger(data.stock) || data.stock < 0) return 'Stock must be a whole number of 0 or more.';
    if (data.hsn && !/^\d{4,8}$/.test(data.hsn)) return 'HSN code must contain 4 to 8 digits.';
    if (data.images.length > 6) return 'Use a maximum of 6 product images.';
    if (data.images.some(url => !validUrl(url))) return 'Every product image URL must start with http:// or https://.';
    if (allProducts.some(p => String(p.sku).toLowerCase() === data.sku.toLowerCase() && p.id !== id)) return 'This seller SKU is already used by another product.';
    if (![data.weightGrams, data.lengthCm, data.widthCm, data.heightCm].every(v => Number.isFinite(v) && v > 0)) return 'Enter valid package weight and dimensions.';
    if (!Number.isInteger(data.dispatchDays) || data.dispatchDays < 1 || data.dispatchDays > 30) return 'Dispatch time must be between 1 and 30 days.';
    if (!Number.isInteger(data.lowStockThreshold) || data.lowStockThreshold < 0) return 'Low-stock threshold must be 0 or more.';
    if (!Number.isInteger(data.returnDays) || data.returnDays < 0 || data.returnDays > 30) return 'Return window must be between 0 and 30 days.';
    if (data.bulkEnabled) {
      if (!Number.isInteger(data.bulkMinQty) || data.bulkMinQty < 2) return 'Bulk minimum quantity must be 2 or more.';
      if (!Number.isFinite(data.bulkPrice) || data.bulkPrice <= 0) return 'Enter a valid bulk unit price.';
      if (data.bulkPrice > data.price) return 'Bulk unit price cannot be higher than regular selling price.';
    }
    if (data.variantsEnabled) {
      if (!data.variants.length) return 'Generate at least one variant before submitting.';
      const seen = new Set();
      for (const row of data.variants) {
        if (!row.sku) return 'Every variant needs a SKU.';
        const key = row.sku.toLowerCase();
        if (seen.has(key)) return 'Variant SKUs must be unique.';
        seen.add(key);
        if (!Number.isInteger(row.stock) || row.stock < 0) return 'Every variant stock value must be a whole number of 0 or more.';
        if (row.priceOverride !== null && (!Number.isFinite(row.priceOverride) || row.priceOverride <= 0)) return 'Variant price overrides must be valid positive values.';
      }
      const otherSkus = new Set();
      allProducts.filter(p => p.id !== id).forEach(p => {
        otherSkus.add(String(p.sku || '').toLowerCase());
        (Array.isArray(p.variants) ? p.variants : []).forEach(v => otherSkus.add(String(v.sku || '').toLowerCase()));
      });
      if (data.variants.some(v => otherSkus.has(v.sku.toLowerCase()))) return 'A variant SKU is already used by another listing.';
    }
    return '';
  }
  function submitAdvanced(event) {
    if (event.target !== form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = bridge.getProducts();
    const id = $('productId').value || null;
    const data = advancedPayload(basePayload());
    const error = validate(data, id, current);
    if (error) { bridge.notify(error); return; }
    const now = new Date().toISOString();
    let next;
    if (id) {
      next = current.map(product => product.id === id ? {...product, ...data, status:'pending', rejectionReason:'', reviewedAt:'', updatedAt:now} : product);
      bridge.notify('Listing details saved and sent back to admin review.');
    } else {
      next = [{id:bridge.makeId(), ...data, status:'pending', rejectionReason:'', createdAt:now, updatedAt:now, reviewedAt:''}, ...current];
      bridge.notify('Detailed product submitted for admin review.');
    }
    bridge.commit(next);
    bridge.close();
    bridge.showPendingProducts();
  }

  $('bulkEnabled').addEventListener('change', toggleBulk);
  $('bulkMinQty').addEventListener('input', updateBulkSummary);
  $('bulkPrice').addEventListener('input', updateBulkSummary);
  $('variantsEnabled').addEventListener('change', toggleVariants);
  $('generateVariants').addEventListener('click', generateVariants);
  $('image').addEventListener('input', renderMediaPreview);
  $('additionalImages').addEventListener('input', renderMediaPreview);
  document.addEventListener('submit', submitAdvanced, true);

  const drawer = $('productDrawer');
  let lastHydratedId = null;
  function hydrateOpenDrawer() {
    if (!drawer.classList.contains('open')) {
      lastHydratedId = null;
      return;
    }
    const id = $('productId').value || '';
    if (lastHydratedId === id) return;
    lastHydratedId = id;
    const product = id ? bridge.getProducts().find(p => String(p.id) === String(id)) : null;
    fillAdvanced(product || null);
  }
  new MutationObserver(hydrateOpenDrawer).observe(drawer, {attributes:true, attributeFilter:['class','aria-hidden']});

  fillAdvanced(null);
})();

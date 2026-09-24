'use strict';
(()=>{
  const bridge=window.SellerCatalogBridge;
  const baseOpenDrawer=window.openDrawer;
  if(!bridge||typeof baseOpenDrawer!=='function'||baseOpenDrawer.__ffAdvancedHydration)return;
  const $=id=>document.getElementById(id);
  const list=value=>[...new Set((Array.isArray(value)?value:[]).map(v=>String(v||'').trim()).filter(Boolean))];
  const setValue=(id,value)=>{const el=$(id);if(el)el.value=value==null?'':String(value)};
  const dispatch=(el,type)=>el?.dispatchEvent(new Event(type,{bubbles:true}));
  const variantKey=(size,color)=>`${String(size||'').toLowerCase()}|${String(color||'').toLowerCase()}`;

  function hydrateVariants(product){
    const enabled=$('variantsEnabled');
    if(!enabled)return;
    const variants=Array.isArray(product?.variants)?product.variants:[];
    enabled.checked=Boolean(product?.variantsEnabled);
    const sizes=String(product?.variantSizes||'').trim()||list(variants.map(v=>v?.size)).join(', ');
    const colors=String(product?.variantColors||'').trim()||list(variants.map(v=>v?.color)).join(', ');
    setValue('variantSizes',sizes);
    setValue('variantColors',colors);
    dispatch(enabled,'change');
    if(!enabled.checked||!variants.length)return;
    const generate=$('generateVariants');
    if(!generate)return;
    generate.click();
    const byKey=new Map(variants.map(v=>[variantKey(v?.size,v?.color),v]));
    document.querySelectorAll('#variantRows [data-variant-row]').forEach(row=>{
      const source=byKey.get(variantKey(row.dataset.size,row.dataset.color));
      if(!source)return;
      const sku=row.querySelector('[data-v-sku]');
      const stock=row.querySelector('[data-v-stock]');
      const price=row.querySelector('[data-v-price]');
      if(sku)sku.value=String(source.sku||'');
      if(stock)stock.value=String(Number.isInteger(source.stock)?source.stock:0);
      if(price)price.value=source.priceOverride==null?'':String(source.priceOverride);
    });
    generate.click();
  }

  function hydrate(product){
    const p=product||{};
    setValue('brand',p.brand||'');
    setValue('modelCode',p.modelCode||'');
    setValue('hsn',p.hsn||'');
    setValue('countryOrigin',p.countryOrigin||'India');

    const bulk=$('bulkEnabled');
    if(bulk){
      bulk.checked=Boolean(p.bulkEnabled);
      setValue('bulkMinQty',p.bulkMinQty??10);
      setValue('bulkPrice',p.bulkPrice??'');
      dispatch(bulk,'change');
    }

    setValue('weightGrams',p.weightGrams??500);
    setValue('dispatchDays',p.dispatchDays??2);
    setValue('lengthCm',p.lengthCm??30);
    setValue('widthCm',p.widthCm??25);
    setValue('heightCm',p.heightCm??5);
    setValue('lowStockThreshold',p.lowStockThreshold??5);
    setValue('returnDays',p.returnDays??7);

    const additional=Array.isArray(p.additionalImages)?p.additionalImages:(Array.isArray(p.images)?p.images.slice(1):[]);
    setValue('additionalImages',additional.join('\n'));
    dispatch($('image'),'input');
    dispatch($('additionalImages'),'input');
    hydrateVariants(p);
  }

  const wrapped=function(id=null){
    baseOpenDrawer(id);
    const product=id?bridge.getProducts().find(p=>String(p.id)===String(id)):null;
    hydrate(product||null);
  };
  wrapped.__ffAdvancedHydration=true;
  wrapped.__ffBaseOpenDrawer=baseOpenDrawer;
  window.openDrawer=wrapped;

  // app.js owns an earlier document-capture click handler. Intercept edit clicks one
  // level earlier so advanced live fields are hydrated before that base handler can
  // open the drawer without them.
  window.addEventListener('click',event=>{
    const target=event.target;
    if(!(target instanceof Element))return;
    const edit=target.closest('[data-edit]');
    if(!edit)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    wrapped(edit.dataset.edit||null);
  },true);
})();

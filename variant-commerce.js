(function(){
'use strict';
const VARIANT_KEY='fashion_fussion_cart_variants';
const API_QUOTE='/api/quote-order';
const API_CREATE='/api/create-order';
function readMap(){try{const value=JSON.parse(localStorage.getItem(VARIANT_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}}
function injectVariants(body){if(!body||!Array.isArray(body.items))return body;const map=readMap();body.items=body.items.map(item=>{const id=String(item?.id??'');const variant=Number(map[id]);if(!Number.isInteger(variant)||variant<=0)return item;return{...item,variant_id:variant}});return body}
const originalFetch=window.fetch.bind(window);
window.fetch=async function(input,init){try{const url=typeof input==='string'?input:String(input?.url||'');const checkoutRequest=url.includes(API_QUOTE)||url.includes(API_CREATE);if(init?.method==='POST'&&checkoutRequest&&typeof init.body==='string'){const parsed=JSON.parse(init.body);injectVariants(parsed);init={...init,body:JSON.stringify(parsed)}}}catch(e){console.warn('Variant checkout adapter skipped request enrichment',e)}return originalFetch(input,init)};
window.FashionVariantCart={
  key:VARIANT_KEY,
  get(productId){const id=Number(readMap()[String(productId)]);return Number.isInteger(id)&&id>0?id:null},
  set(productId,variantId){const map=readMap(),pid=String(productId),vid=Number(variantId);if(Number.isInteger(vid)&&vid>0)map[pid]=vid;else delete map[pid];localStorage.setItem(VARIANT_KEY,JSON.stringify(map));return map[pid]||null},
  remove(productId){const map=readMap();delete map[String(productId)];localStorage.setItem(VARIANT_KEY,JSON.stringify(map))},
  clear(){localStorage.removeItem(VARIANT_KEY)},
  injectVariants
};
})();

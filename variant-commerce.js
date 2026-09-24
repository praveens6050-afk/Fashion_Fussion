(function(){
'use strict';
if((location.pathname.split('/').pop()||'index.html')==='product.html'&&!document.querySelector('script[data-desktop-commerce-loader]')){const s=document.createElement('script');s.src='desktop-commerce-loader.js?v=1';s.async=false;s.setAttribute('data-desktop-commerce-loader','true');document.head.appendChild(s)}
const LEGACY_KEY='fashion_fussion_cart';
const LINE_KEY='fashion_fussion_cart_lines_v2';
const VARIANT_KEY='fashion_fussion_cart_variants';
const CHECKOUT_KEY='fashion_fussion_checkout_key';
const API_QUOTE='/api/quote-order';
const API_CREATE='/api/create-order';
function safeParse(value,fallback){try{const parsed=JSON.parse(value);return parsed??fallback}catch{return fallback}}
function validLine(line){const id=Number(line?.id),variant=line?.variant_id==null?null:Number(line.variant_id),qty=Number(line?.qty);return Number.isInteger(id)&&id>0&&(variant===null||(Number.isInteger(variant)&&variant>0))&&Number.isInteger(qty)&&qty>0&&qty<=500}
function lineKey(id,variantId){return String(id)+':'+(variantId==null?'base':String(variantId))}
function readVariantMap(){const value=safeParse(localStorage.getItem(VARIANT_KEY),'');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function readLegacy(){const value=safeParse(localStorage.getItem(LEGACY_KEY),{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function normalizeLines(lines){const merged=new Map();for(const raw of Array.isArray(lines)?lines:[]){if(!validLine(raw))continue;const id=Number(raw.id),variantId=raw.variant_id==null?null:Number(raw.variant_id),key=lineKey(id,variantId);const current=merged.get(key)||{id,variant_id:variantId,qty:0};current.qty=Math.min(500,current.qty+Number(raw.qty));merged.set(key,current)}return [...merged.values()]}
function migrateLegacy(){const stored=safeParse(localStorage.getItem(LINE_KEY),null);if(Array.isArray(stored))return normalizeLines(stored);const legacy=readLegacy(),variantMap=readVariantMap(),lines=[];for(const [idRaw,qtyRaw] of Object.entries(legacy)){const id=Number(idRaw),qty=Math.min(500,Math.max(1,Math.floor(Number(qtyRaw)||0)));if(!Number.isInteger(id)||id<=0||!qty)continue;const mapped=Number(variantMap[String(id)]);lines.push({id,variant_id:Number.isInteger(mapped)&&mapped>0?mapped:null,qty})}const normalized=normalizeLines(lines);localStorage.setItem(LINE_KEY,JSON.stringify(normalized));return normalized}
function readLines(){return migrateLegacy()}
function writeLines(lines,{syncLegacy=true,invalidateCheckout=true}={}){const normalized=normalizeLines(lines);localStorage.setItem(LINE_KEY,JSON.stringify(normalized));if(syncLegacy){const aggregate={};for(const line of normalized)aggregate[line.id]=Math.min(500,(Number(aggregate[line.id])||0)+line.qty);localStorage.setItem(LEGACY_KEY,JSON.stringify(aggregate))}if(invalidateCheckout)sessionStorage.removeItem(CHECKOUT_KEY);return normalized}
function addLine(productId,variantId,qty){const id=Number(productId),variant=variantId==null?null:Number(variantId),amount=Math.min(500,Math.max(1,Math.floor(Number(qty)||1)));if(!Number.isInteger(id)||id<=0)return null;if(variant!==null&&(!Number.isInteger(variant)||variant<=0))return null;const lines=readLines(),key=lineKey(id,variant),existing=lines.find(line=>lineKey(line.id,line.variant_id)===key);if(existing)existing.qty=Math.min(500,existing.qty+amount);else lines.push({id,variant_id:variant,qty:amount});writeLines(lines,{syncLegacy:false});return lines.find(line=>lineKey(line.id,line.variant_id)===key)||null}
function addSyncedLine(productId,variantId,qty){const id=Number(productId),variant=variantId==null?null:Number(variantId),amount=Math.min(500,Math.max(1,Math.floor(Number(qty)||1)));if(!Number.isInteger(id)||id<=0)return null;if(variant!==null&&(!Number.isInteger(variant)||variant<=0))return null;const lines=readLines(),key=lineKey(id,variant),existing=lines.find(line=>lineKey(line.id,line.variant_id)===key);if(existing)existing.qty=Math.min(500,existing.qty+amount);else lines.push({id,variant_id:variant,qty:amount});if(variant!==null){const map=readVariantMap();map[String(id)]=variant;localStorage.setItem(VARIANT_KEY,JSON.stringify(map))}const normalized=writeLines(lines);return normalized.find(line=>lineKey(line.id,line.variant_id)===key)||null}
function updateLine(productId,variantId,qty){const id=Number(productId),variant=variantId==null?null:Number(variantId),amount=Math.floor(Number(qty)||0),key=lineKey(id,variant);const lines=readLines().filter(line=>lineKey(line.id,line.variant_id)!==key);if(amount>0)lines.push({id,variant_id:variant,qty:Math.min(500,amount)});return writeLines(lines)}
function removeLine(productId,variantId){return updateLine(productId,variantId,0)}
function clear(){localStorage.removeItem(LINE_KEY);localStorage.removeItem(VARIANT_KEY);sessionStorage.removeItem(CHECKOUT_KEY)}
function injectVariants(body){
  if(!body||!Array.isArray(body.items))return body;
  const submitted=normalizeLines(body.items);
  if(!submitted.length)return body;
  if(submitted.some(line=>line.variant_id!=null)){
    body.items=submitted;
    return body;
  }
  const stored=readLines();
  if(!stored.length)return body;
  const byProduct=new Map();
  for(const line of stored){const list=byProduct.get(line.id)||[];list.push(line);byProduct.set(line.id,list)}
  const enriched=[];
  const synced=stored.map(line=>({...line}));
  let changed=false;
  for(const requestLine of submitted){
    const saved=byProduct.get(requestLine.id)||[];
    if(saved.length===1){
      const savedLine=saved[0];
      enriched.push({id:requestLine.id,variant_id:savedLine.variant_id,qty:requestLine.qty});
      const target=synced.find(line=>lineKey(line.id,line.variant_id)===lineKey(savedLine.id,savedLine.variant_id));
      if(target&&target.qty!==requestLine.qty){target.qty=requestLine.qty;changed=true}
      continue;
    }
    if(saved.length>1){
      const savedTotal=saved.reduce((sum,line)=>sum+Number(line.qty||0),0);
      if(savedTotal===requestLine.qty){for(const savedLine of saved)enriched.push({id:savedLine.id,variant_id:savedLine.variant_id,qty:savedLine.qty});continue}
    }
    enriched.push(requestLine);
  }
  if(changed)writeLines(synced,{syncLegacy:false,invalidateCheckout:false});
  body.items=enriched;
  return body;
}
async function resolveSingleSellableVariants(body){if(!body||!Array.isArray(body.items)||!window.supabaseClient)return body;const missing=[...new Set(body.items.filter(item=>item?.variant_id==null).map(item=>Number(item?.id)).filter(Number.isInteger))];if(!missing.length)return body;const{data:variants,error}=await window.supabaseClient.from('product_variants').select('id,product_id,is_active').in('product_id',missing).eq('is_active',true);if(error)throw error;for(const productId of missing){const candidates=(variants||[]).filter(v=>Number(v.product_id)===productId);if(!candidates.length)continue;const{data:availability,error:availabilityError}=await window.supabaseClient.rpc('get_variant_availability',{p_product_id:productId});if(availabilityError)throw availabilityError;const inStock=new Set((availability||[]).filter(x=>x.in_stock===true).map(x=>Number(x.variant_id)));const sellable=candidates.filter(v=>inStock.has(Number(v.id)));if(sellable.length!==1)continue;const variantId=Number(sellable[0].id);const map=readVariantMap();map[String(productId)]=variantId;localStorage.setItem(VARIANT_KEY,JSON.stringify(map));const lines=readLines().map(line=>line.id===productId&&line.variant_id==null?{...line,variant_id:variantId}:line);writeLines(lines,{syncLegacy:false});body.items=body.items.map(item=>Number(item?.id)===productId&&item?.variant_id==null?{...item,variant_id:variantId}:item)}return body}
const originalFetch=window.fetch.bind(window);
window.fetch=async function(input,init){try{const url=typeof input==='string'?input:String(input?.url||'');const checkoutRequest=url.includes(API_QUOTE)||url.includes(API_CREATE);if(init?.method==='POST'&&checkoutRequest&&typeof init.body==='string'){const parsed=JSON.parse(init.body);injectVariants(parsed);await resolveSingleSellableVariants(parsed);injectVariants(parsed);init={...init,body:JSON.stringify(parsed)}}}catch(e){console.warn('Variant checkout adapter skipped request enrichment',e)}return originalFetch(input,init)};
const originalRemoveItem=Storage.prototype.removeItem;
Storage.prototype.removeItem=function(key){const result=originalRemoveItem.call(this,key);if(this===localStorage&&key===LEGACY_KEY){originalRemoveItem.call(this,LINE_KEY);originalRemoveItem.call(this,VARIANT_KEY)}return result};
window.FashionVariantCart={key:VARIANT_KEY,lineKey:LINE_KEY,get(productId){const id=Number(readVariantMap()[String(productId)]);return Number.isInteger(id)&&id>0?id:null},set(productId,variantId){const map=readVariantMap(),pid=String(productId),vid=Number(variantId);if(Number.isInteger(vid)&&vid>0)map[pid]=vid;else delete map[pid];localStorage.setItem(VARIANT_KEY,JSON.stringify(map));return map[pid]||null},remove(productId){const map=readVariantMap();delete map[String(productId)];localStorage.setItem(VARIANT_KEY,JSON.stringify(map))},clear,readLines,writeLines,addLine,addSyncedLine,updateLine,removeLine,injectVariants,resolveSingleSellableVariants};
})();

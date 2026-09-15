(function(){
'use strict';
const page=location.pathname.split('/').pop()||'index.html';
if(!['index.html','search.html'].includes(page))return;
const CART_KEY='fashion_fussion_cart';
const CHECKOUT_KEY='fashion_fussion_checkout_key';
const variantFlags=new Map();
let loadingFlags=null;
function productUrl(id){return 'product.html?id='+encodeURIComponent(id)}
function readCart(){try{const value=JSON.parse(localStorage.getItem(CART_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}}
function addBaseProduct(id){const cart=readCart();cart[id]=Math.min(500,Math.max(0,Number(cart[id])||0)+1);localStorage.setItem(CART_KEY,JSON.stringify(cart));sessionStorage.removeItem(CHECKOUT_KEY);const count=document.getElementById('cartCount');if(count)count.textContent=Object.values(cart).reduce((sum,qty)=>sum+Math.max(0,Number(qty)||0),0);const toast=document.getElementById('toast');if(toast){toast.textContent='Added to cart';toast.classList.add('show');clearTimeout(window.__catalogVariantToast);window.__catalogVariantToast=setTimeout(()=>toast.classList.remove('show'),1600)}}
function annotate(){document.querySelectorAll('[data-add]').forEach(button=>{const id=Number(button.dataset.add);if(!Number.isInteger(id)||id<=0)return;const hasVariants=variantFlags.get(id)===true;button.textContent=hasVariants?'CHOOSE OPTIONS':'ADD TO CART';button.setAttribute('aria-label',hasVariants?'Choose product options':'Add product to cart')})}
async function loadFlags(){if(loadingFlags)return loadingFlags;loadingFlags=(async()=>{const{data,error}=await window.supabaseClient.from('products').select('id,has_variants').eq('is_active',true);if(error)throw error;(data||[]).forEach(row=>variantFlags.set(Number(row.id),row.has_variants===true));annotate()})();try{await loadingFlags}finally{loadingFlags=null}}
async function resolveFlag(id){if(variantFlags.has(id))return variantFlags.get(id);try{const{data,error}=await window.supabaseClient.from('products').select('id,has_variants').eq('id',id).eq('is_active',true).maybeSingle();if(error)throw error;const value=data?.has_variants===true;variantFlags.set(id,value);annotate();return value}catch(error){console.warn('Could not verify catalogue variant state; opening product details instead.',error);return true}}
document.addEventListener('click',event=>{const button=event.target?.closest?.('[data-add]');if(!button)return;const id=Number(button.dataset.add);if(!Number.isInteger(id)||id<=0)return;const known=variantFlags.get(id);if(known===false)return;event.preventDefault();event.stopImmediatePropagation();if(known===true){location.href=productUrl(id);return}button.disabled=true;resolveFlag(id).then(hasVariants=>{if(hasVariants){location.href=productUrl(id);return}button.disabled=false;addBaseProduct(id)}).catch(()=>{button.disabled=false;location.href=productUrl(id)})},true);
const observer=new MutationObserver(annotate);function start(){observer.observe(document.body,{childList:true,subtree:true});loadFlags().catch(error=>console.warn('Catalogue variant guard could not preload product flags.',error));annotate()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

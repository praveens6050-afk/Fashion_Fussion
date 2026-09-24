'use strict';
const SUPABASE_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
const SUPABASE_SRI='sha384-iLddHTLokph6Omwoyid4XKxHaWa6w41BnoEj0q5oOrzmYPpHIKt1wyjReA7s//pP';
const SUPABASE_FALLBACK_URLS=[
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js',
  'https://unpkg.com/@supabase/supabase-js@2.116.0/dist/umd/supabase.js?ff-retry=1'
];
const SELLER_REMEMBER_KEY='ff_seller_remember_mode';

const sellerAuthStorage={
  getItem(key){return (localStorage.getItem(SELLER_REMEMBER_KEY)==='true'?localStorage:sessionStorage).getItem(key)},
  setItem(key,value){return (localStorage.getItem(SELLER_REMEMBER_KEY)==='true'?localStorage:sessionStorage).setItem(key,value)},
  removeItem(key){localStorage.removeItem(key);sessionStorage.removeItem(key)}
};

function createSellerSupabaseClient(){
  if(window.supabaseClient)return window.supabaseClient;
  if(!window.supabase||typeof window.supabase.createClient!=='function')return null;
  window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:sellerAuthStorage}});
  return window.supabaseClient;
}

function appendScriptWhenReady(script,preferred='head'){
  return new Promise((resolve,reject)=>{
    const append=()=>{
      const target=(preferred==='body'?document.body:document.head)||document.documentElement;
      if(!target){reject(new Error('Document is not ready to load Seller services'));return}
      script.onload=()=>resolve();
      script.onerror=()=>reject(new Error('Seller service script failed to load'));
      target.appendChild(script);
    };
    if((preferred==='body'&&!document.body)||(preferred==='head'&&!document.head))document.addEventListener('DOMContentLoaded',append,{once:true});
    else append();
  });
}

function loadSellerSdkWithTimeout(src,timeoutMs=6500){
  return new Promise((resolve,reject)=>{
    if(window.supabase&&typeof window.supabase.createClient==='function'){resolve();return}
    const script=document.createElement('script');
    script.src=src;
    script.integrity=SUPABASE_SRI;
    script.crossOrigin='anonymous';
    script.referrerPolicy='no-referrer';
    script.async=true;
    let settled=false;
    const finish=error=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(error)reject(error);else resolve();
    };
    const timer=setTimeout(()=>finish(new Error('Seller service script timed out')),timeoutMs);
    script.onload=()=>finish();
    script.onerror=()=>finish(new Error('Seller service script failed to load'));
    (document.head||document.documentElement).appendChild(script);
  });
}

const sellerPath=(location.pathname.split('/').pop()||'index.html').toLowerCase();
const isSellerLogin=sellerPath==='login'||sellerPath==='login.html';

function sellerLiveNumber(value){return value===''||value==null?null:Number(value)}
function sellerLiveVariants(){
  return [...document.querySelectorAll('#variantRows [data-variant-row]')].map(row=>({
    size:row.dataset.size||'',
    color:row.dataset.color||'',
    sku:row.querySelector('[data-v-sku]')?.value.trim().toUpperCase()||'',
    stock:Number(row.querySelector('[data-v-stock]')?.value||0),
    priceOverride:row.querySelector('[data-v-price]')?.value===''?null:sellerLiveNumber(row.querySelector('[data-v-price]')?.value)
  }));
}
function sellerLiveProductFormData(){
  const get=id=>document.getElementById(id);
  const variantsEnabled=Boolean(get('variantsEnabled')?.checked);
  return{
    name:get('name')?.value.trim(),category:get('category')?.value.trim(),sku:get('sku')?.value.trim().toUpperCase(),description:get('description')?.value.trim(),
    price:Number(get('price')?.value),mrp:Number(get('mrp')?.value),stock:Number(get('stock')?.value),gst:Number(get('gst')?.value||18),image:get('image')?.value.trim(),
    brand:get('brand')?.value.trim()||'',modelCode:get('modelCode')?.value.trim()||'',hsn:get('hsn')?.value.trim()||'',countryOrigin:get('countryOrigin')?.value.trim()||'',
    bulkEnabled:Boolean(get('bulkEnabled')?.checked),bulkMinQty:sellerLiveNumber(get('bulkMinQty')?.value),bulkPrice:sellerLiveNumber(get('bulkPrice')?.value),
    variantsEnabled,variants:variantsEnabled?sellerLiveVariants():[],additionalImages:String(get('additionalImages')?.value||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean).slice(0,5),
    weightGrams:sellerLiveNumber(get('weightGrams')?.value),dispatchDays:sellerLiveNumber(get('dispatchDays')?.value),lengthCm:sellerLiveNumber(get('lengthCm')?.value),widthCm:sellerLiveNumber(get('widthCm')?.value),heightCm:sellerLiveNumber(get('heightCm')?.value),
    lowStockThreshold:Number(get('lowStockThreshold')?.value||0),returnDays:sellerLiveNumber(get('returnDays')?.value)
  };
}

if(!isSellerLogin){
  document.addEventListener('submit',event=>{
    if(event.target?.id!=='productForm')return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const live=window.SellerLiveIntegration;
    if(!live?.submit){
      window.SellerCatalogBridge?.notify?.('Live seller catalog is still loading. Please wait a moment and try again.');
      return;
    }
    live.submit(sellerLiveProductFormData(),document.getElementById('productId')?.value||null);
  },true);

  document.documentElement.classList.add('seller-live-loading');
  if(!document.getElementById('seller-live-bootstrap-style')){
    const style=document.createElement('style');
    style.id='seller-live-bootstrap-style';
    style.textContent='.seller-live-loading body{visibility:visible!important}.seller-live-loading .shell{visibility:hidden!important}.seller-live-loading body::before{content:"Loading Seller Center…";position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#f6f7fb;color:#344054;font:700 15px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}';
    (document.head||document.documentElement).appendChild(style);
  }
  if(!document.querySelector('script[data-seller-launch-safety]')){
    const guard=document.createElement('script');
    guard.src='seller-launch-safety.js?v=20260924-startup-fix';
    guard.async=false;
    guard.setAttribute('data-seller-launch-safety','true');
    appendScriptWhenReady(guard,'head').catch(error=>console.error('[Seller Center] Launch safety failed',error));
  }
  if(!localStorage.getItem('ff_seller_session_v1')&&!sessionStorage.getItem('ff_seller_session_v1'))sessionStorage.setItem('ff_seller_session_v1',JSON.stringify({sellerId:'LIVE',storeName:'Seller',email:'',name:'Seller',authProvider:'supabase-pending'}));
}

window.ffSellerSupabaseReady=(async()=>{
  let client=createSellerSupabaseClient();
  if(client)return client;
  let lastError=null;
  for(const src of SUPABASE_FALLBACK_URLS){
    try{
      await loadSellerSdkWithTimeout(src);
      client=createSellerSupabaseClient();
      if(client)return client;
    }catch(error){lastError=error;console.warn('[Seller Center] Supabase source unavailable',src,error?.message||error)}
  }
  throw lastError||new Error('Seller services could not start. Check your connection and reload the page.');
})();
window.ffSupabaseReady=window.ffSellerSupabaseReady;

function loadSellerPayoutProvider(){
  if(isSellerLogin||document.querySelector('script[data-seller-payout-provider]'))return;
  const payout=document.createElement('script');
  payout.src='seller-payout-provider.js?v=20260924';
  payout.async=true;
  payout.setAttribute('data-seller-payout-provider','true');
  appendScriptWhenReady(payout,'body').catch(error=>console.error('[Seller Center] Payout provider integration failed',error));
}

let startupFailTimer=null;
if(!isSellerLogin){
  startupFailTimer=setTimeout(()=>{
    if(!document.documentElement.classList.contains('seller-live-loading'))return;
    if(window.__sellerLiveSellerVerified===true&&window.SellerLiveIntegration&&window.SellerCatalogBridge){
      console.warn('[Seller Center] Verified seller catalog bootstrap is still in progress',window.__sellerLiveBootStage||'unknown');
      return;
    }
    console.error('[Seller Center] Startup verification timed out',window.__sellerLiveBootStage||'unknown');
    document.documentElement.classList.remove('seller-live-loading');
    location.replace('login.html?startup=timeout');
  },45000);
}

window.ffSellerSupabaseReady.then(()=>{
  if(isSellerLogin){if(startupFailTimer)clearTimeout(startupFailTimer);return}
  if(window.SellerLiveIntegration){loadSellerPayoutProvider();return}
  window.__sellerLiveIntegrationBooted=false;
  if(document.querySelector('script[data-seller-live-recovery]')){loadSellerPayoutProvider();return}
  const script=document.createElement('script');
  script.src='seller-live-integration.js?v=20260925-bootstrap-retry';
  script.async=false;
  script.setAttribute('data-seller-live-recovery','true');
  appendScriptWhenReady(script,'body').then(loadSellerPayoutProvider).catch(error=>{
    console.error('[Seller Center] Live integration recovery failed',error);
    document.documentElement.classList.remove('seller-live-loading');
    location.replace('login.html?startup=integration');
  });
}).catch(error=>{
  console.error('[Seller Center] Supabase startup failed',error);
  if(startupFailTimer)clearTimeout(startupFailTimer);
  document.documentElement.classList.remove('seller-live-loading');
  if(!isSellerLogin)location.replace('login.html?startup=service');
});
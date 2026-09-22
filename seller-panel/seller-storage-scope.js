'use strict';

(()=>{
  const SESSION_KEY='ff_seller_session_v1';
  const SCOPED_KEYS=new Set(['ff_seller_panel_demo_v1']);
  const rawGet=Storage.prototype.getItem;
  const rawSet=Storage.prototype.setItem;
  const rawRemove=Storage.prototype.removeItem;

  function readSessionRaw(){
    try{return JSON.parse(rawGet.call(localStorage,SESSION_KEY)||rawGet.call(sessionStorage,SESSION_KEY)||'null')}
    catch{return null}
  }

  const session=readSessionRaw();
  if(!session)return;
  const sellerKey=String(session.sellerId||session.email||'seller').replace(/[^A-Za-z0-9@._-]/g,'_');
  const physicalKey=key=>`${key}::${sellerKey}`;

  if(!window.__sellerStorageScopeInstalled){
    Storage.prototype.getItem=function(key){
      if(this===localStorage&&SCOPED_KEYS.has(String(key)))return rawGet.call(this,physicalKey(String(key)));
      return rawGet.call(this,key);
    };
    Storage.prototype.setItem=function(key,value){
      if(this===localStorage&&SCOPED_KEYS.has(String(key)))return rawSet.call(this,physicalKey(String(key)),value);
      return rawSet.call(this,key,value);
    };
    Storage.prototype.removeItem=function(key){
      if(this===localStorage&&SCOPED_KEYS.has(String(key)))return rawRemove.call(this,physicalKey(String(key)));
      return rawRemove.call(this,key);
    };
    window.__sellerStorageScopeInstalled=true;
  }

  // Supabase is authoritative. Never reveal stale/demo catalog data if live loading fails.
  try{
    if(typeof products!=='undefined')products=[];
    if(typeof persist==='function')persist();
    if(typeof renderAll==='function')renderAll();
    if(typeof syncTabs==='function')syncTabs();
  }catch(error){
    console.warn('[Seller storage scope] Catalog reset skipped',error);
  }
})();

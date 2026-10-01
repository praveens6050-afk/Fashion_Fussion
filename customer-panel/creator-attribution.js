'use strict';
(function(){
  const KEY='fashion_fussion_creator_ref_v1';
  const TTL=7*24*60*60*1000;
  function clean(v){const x=String(v||'').trim().toUpperCase();return /^[A-Z0-9]{6,20}$/.test(x)?x:''}
  function read(){try{const v=JSON.parse(localStorage.getItem(KEY)||'null');if(!v||!clean(v.code)||Date.now()-Number(v.savedAt||0)>TTL){localStorage.removeItem(KEY);return null}return v}catch{return null}}
  function capture(){const u=new URL(location.href),code=clean(u.searchParams.get('ref')||u.searchParams.get('creator'));if(!code)return read();const value={code,savedAt:Date.now()};localStorage.setItem(KEY,JSON.stringify(value));return value}
  async function sync(){const value=capture();if(!value||!window.supabaseClient)return;try{const{data:{user}}=await window.supabaseClient.auth.getUser();if(!user)return;const{error}=await window.supabaseClient.rpc('record_creator_attribution',{p_code:value.code});if(error){console.warn('Creator attribution not recorded:',error.message);return}localStorage.setItem(KEY,JSON.stringify({...value,syncedUser:user.id,syncedAt:Date.now()}))}catch(error){console.warn('Creator attribution sync failed:',error)}}
  async function start(){try{if(window.ffSupabaseReady)await window.ffSupabaseReady;await sync()}catch(error){console.warn('Creator attribution unavailable:',error)}}
  window.FFCreatorAttribution={read,capture,sync};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

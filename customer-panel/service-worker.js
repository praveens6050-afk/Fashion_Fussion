'use strict';
const CACHE_NAME='fashion-fussion-shell-v1';
const SHELL=['./offline.html','./app-icon.svg','./app-icon-maskable.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(/\/(auth|checkout|account|cart|order)(\/|\.|$)/i.test(url.pathname))return;
 if(request.mode==='navigate')event.respondWith(fetch(request).catch(async()=>await caches.match('./offline.html')||new Response('You are offline. Reconnect to continue shopping.',{headers:{'Content-Type':'text/plain; charset=utf-8'}})));
});
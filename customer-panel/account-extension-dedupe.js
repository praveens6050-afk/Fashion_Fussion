(function(){
'use strict';
if(window.__ffAccountExtensionDedupeInstalled)return;
window.__ffAccountExtensionDedupeInstalled=true;

const targets={
  returns:{button:'button[data-view="returns"]',view:'#returnsView'},
  business:{button:'button[data-view="business"]',view:'#businessView'}
};

let queued=false;
function removeExtras(selector){
  const nodes=Array.from(document.querySelectorAll(selector));
  nodes.slice(1).forEach(node=>node.remove());
}
function dedupe(){
  queued=false;
  Object.values(targets).forEach(target=>{
    removeExtras('.menu '+target.button);
    removeExtras(target.view);
  });
}
function schedule(){
  if(queued)return;
  queued=true;
  queueMicrotask(dedupe);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',dedupe,{once:true});
else dedupe();

const root=document.documentElement;
if(root){
  const observer=new MutationObserver(schedule);
  observer.observe(root,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
}
})();

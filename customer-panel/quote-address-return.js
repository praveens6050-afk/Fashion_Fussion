(function(){
'use strict';
const quote=new URLSearchParams(location.search).get('quote');
if(!/^\d+$/.test(String(quote||'')))return;
const href='account.html?return=quote-checkout&quote='+encodeURIComponent(quote)+'#addresses';
function sync(){
  document.querySelectorAll('a[href="account.html#addresses"]').forEach(link=>link.setAttribute('href',href));
}
sync();
const box=document.getElementById('addressBox');
if(box)new MutationObserver(sync).observe(box,{childList:true,subtree:true});
})();

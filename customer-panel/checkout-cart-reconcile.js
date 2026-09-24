(function(){
'use strict';
const LEGACY_KEY='fashion_fussion_cart';
const CHECKOUT_KEY='fashion_fussion_checkout_key';
const cart=window.FashionVariantCart;
if(!cart?.readLines)return;
const lines=cart.readLines();
const aggregate={};
for(const line of lines){
  const id=Number(line?.id),qty=Number(line?.qty);
  if(!Number.isInteger(id)||id<=0||!Number.isInteger(qty)||qty<=0)continue;
  aggregate[id]=Math.min(500,(Number(aggregate[id])||0)+qty);
}
let previous={};
try{const value=JSON.parse(localStorage.getItem(LEGACY_KEY)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))previous=value}catch{}
const normalizedPrevious={};
for(const[id,qty]of Object.entries(previous)){
  const n=Math.min(500,Math.max(0,Math.floor(Number(qty)||0)));
  if(n)normalizedPrevious[id]=n;
}
const before=JSON.stringify(normalizedPrevious);
const after=JSON.stringify(aggregate);
if(before!==after){
  localStorage.setItem(LEGACY_KEY,after);
  sessionStorage.removeItem(CHECKOUT_KEY);
}
})();

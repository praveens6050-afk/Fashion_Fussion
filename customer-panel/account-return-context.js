(function(){
'use strict';
const params=new URLSearchParams(location.search);
const returnKind=params.get('return');
const quote=params.get('quote');
if(returnKind!=='quote-checkout'||!/^\d+$/.test(String(quote||'')))return;
const target='quote-checkout.html?quote='+encodeURIComponent(quote);
const form=document.getElementById('addressForm');
if(!form)return;
const head=document.querySelector('#addressesView .panel-head');
if(head&&!document.getElementById('returnToQuoteCheckout')){
  const link=document.createElement('a');
  link.id='returnToQuoteCheckout';
  link.className='btn';
  link.href=target;
  link.textContent='← Return to quote checkout';
  head.insertBefore(link,document.getElementById('addAddress')||null);
}
const original=form.onsubmit;
if(typeof original!=='function')return;
form.onsubmit=async function(event){
  await original.call(this,event);
  if(!form.classList.contains('show'))location.assign(target);
};
})();

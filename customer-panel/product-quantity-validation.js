(function(){
'use strict';
function invalidQuantity(){
  const input=document.getElementById('qty');
  if(!input)return false;
  const raw=String(input.value||'').trim();
  const value=Number(raw);
  return raw===''||!Number.isInteger(value)||value<1||value>500;
}
function warn(){
  const input=document.getElementById('qty');
  const toast=document.getElementById('toast');
  if(input){input.setAttribute('aria-invalid','true');input.focus();}
  if(toast){toast.textContent='Enter a quantity between 1 and 500.';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1900);}
}
document.addEventListener('input',event=>{if(event.target?.id==='qty'&&!invalidQuantity())event.target.removeAttribute('aria-invalid')},true);
document.addEventListener('click',event=>{
  const button=event.target?.closest?.('#add,#buy');
  if(!button||!invalidQuantity())return;
  event.preventDefault();
  event.stopImmediatePropagation();
  warn();
},true);
})();

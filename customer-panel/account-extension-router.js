(function(){
'use strict';
const extensionViews=new Set(['returns','business']);
let requested=extensionViews.has(location.hash.slice(1))?location.hash.slice(1):'';
function activate(view){if(!extensionViews.has(view))return false;const button=document.querySelector('.menu button[data-view="'+view+'"]'),app=document.getElementById('app');if(!button||!app||app.hidden)return false;button.click();return true}
function restore(){if(!requested)return;let tries=0;const timer=setInterval(()=>{tries++;if(activate(requested)||tries>60)clearInterval(timer)},100)}
window.addEventListener('hashchange',event=>{try{const view=new URL(event.newURL).hash.slice(1);if(!extensionViews.has(view))return;requested=view;setTimeout(()=>activate(view),0)}catch{}});
restore();
})();

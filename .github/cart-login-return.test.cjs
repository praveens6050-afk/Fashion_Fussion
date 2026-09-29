const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname,'../customer-panel/cart-login-return.js'),'utf8');

function fixture(signedIn=false) {
  let observer, pending=false, writes=0;
  const timers=[];
  const textNode=value=>({
    get textContent(){return value;},
    set textContent(next){value=next;writes++;if(observer)pending=true;}
  });
  const link=textNode('Sign in');
  let href='login.html?redirect=checkout';
  Object.defineProperty(link,'href',{get:()=>href,set:v=>{href=v;}});
  link.getAttribute=()=>href;
  link.setAttribute=(_key,value)=>{href=value;};
  const muted=textNode('You can also continue and sign in during checkout.');
  const address={querySelectorAll:()=>signedIn?[]:[link],querySelector:()=>muted};
  const button={dataset:{},disabled:false};
  const context={
    document:{readyState:'complete',visibilityState:'visible',getElementById:id=>id==='address'?address:id==='place'?button:null},
    window:{supabaseClient:{auth:{getSession:async()=>({data:{session:signedIn?{user:{id:'test'}}:null}})}}},
    location:{href:''},
    MutationObserver:class{constructor(fn){this.fn=fn;}observe(){observer=this.fn;}},
    setTimeout:fn=>{timers.push(fn);},encodeURIComponent
  };
  vm.createContext(context);
  const settle=()=>{let rounds=0;while(pending){pending=false;observer();assert.ok(++rounds<10,'Observer feedback loop must settle instead of freezing the cart');}};
  vm.runInContext(source,context);
  for(const timer of [...timers]){timer();settle();}
  return {context,link,muted,button,settle,source,writeCount:()=>writes};
}

(async()=>{
  const signedOut=fixture();
  assert.equal(signedOut.link.href,'login.html?redirect=cart.html');
  assert.match(signedOut.muted.textContent,/return to this cart/);
  signedOut.muted.textContent='Address renderer refreshed its copy';
  signedOut.settle();
  assert.match(signedOut.muted.textContent,/return to this cart/);
  const writes=signedOut.writeCount();
  vm.runInContext(source,signedOut.context);
  signedOut.settle();
  assert.equal(signedOut.writeCount(),writes,'Repeated script loads must not repeat DOM writes');
  await signedOut.button.onclick({preventDefault(){}});
  assert.equal(signedOut.context.location.href,'login.html?redirect=cart.html');
  const signedIn=fixture(true);
  assert.equal(signedIn.writeCount(),0,'Signed-in address content must remain untouched');
  await signedIn.button.onclick({preventDefault(){}});
  assert.equal(signedIn.context.location.href,'checkout.html');
  console.log('PASS observer settles, survives rerender/replay, and checkout routes correctly');
})().catch(error=>{console.error(error);process.exitCode=1;});

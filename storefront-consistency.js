(function(){
  'use strict';
  const DELIVERY_THRESHOLD_CORRECT=299;
  const DELIVERY_CHARGE_CORRECT=49;
  const replacements=[
    [/₹599/g,'₹299'],
    [/above ₹599/gi,'above ₹299'],
    [/9am\s*[–-]\s*7pm/gi,'24/7'],
    [/Same-week dispatch/gi,'Dispatch within 3 days']
  ];

  function fixText(root=document.body){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let n;
    while((n=walker.nextNode())){
      const old=n.nodeValue||'';
      let next=old;
      for(const [re,to] of replacements)next=next.replace(re,to);
      if(next!==old)n.nodeValue=next;
    }
  }

  function installPricingFix(){
    try{
      if(typeof calculateCartPricing!=='function' || typeof PRODUCTS==='undefined' || typeof cart==='undefined')return false;
      calculateCartPricing=function(){
        let subtotal=0;
        const ids=Object.keys(cart).filter(id=>{
          const q=Number(cart[id]);
          return Number.isInteger(q)&&q>0&&q<=20;
        });
        ids.forEach(id=>{
          const p=PRODUCTS.find(x=>String(x.id)===String(id));
          if(!p)return;
          subtotal+=productPrice(p)*Number(cart[id]);
        });
        const discount=Math.min(Math.max(Number(typeof DISCOUNT_AMOUNT!=='undefined'?DISCOUNT_AMOUNT:0)||0,0),subtotal);
        const taxableSubtotal=Math.max(subtotal-discount,0);
        let gst=0;
        ids.forEach(id=>{
          const p=PRODUCTS.find(x=>String(x.id)===String(id));
          if(!p)return;
          const lineSubtotal=productPrice(p)*Number(cart[id]);
          const proportion=subtotal>0?lineSubtotal/subtotal:0;
          const taxableLine=Math.max(lineSubtotal-discount*proportion,0);
          gst+=taxableLine*getGstRate(p);
        });
        const delivery=taxableSubtotal<=0?0:(taxableSubtotal>=DELIVERY_THRESHOLD_CORRECT?0:DELIVERY_CHARGE_CORRECT);
        const otherCharges=Math.max(Number(typeof OTHER_CHARGES!=='undefined'?OTHER_CHARGES:0)||0,0);
        return{subtotal,discount,gst,delivery,otherCharges,total:taxableSubtotal+gst+delivery+otherCharges};
      };
      return true;
    }catch(e){console.error('Storefront pricing consistency error:',e);return false;}
  }

  function fix(){fixText(document.body);installPricingFix();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fix);else fix();
  const obs=new MutationObserver(()=>fixText(document.body));
  if(document.documentElement)obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  let tries=0;const timer=setInterval(()=>{tries++;if(installPricingFix()||tries>30)clearInterval(timer)},100);
})();
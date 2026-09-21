(()=>{'use strict';
  function eligible(order){
    const status=String(order?.status||'').toLowerCase();
    const fulfillment=String(order?.fulfillment_status||'ordered').toLowerCase();
    return order?.payment_method==='prepaid'&&status==='paid'&&['ordered','packed'].includes(fulfillment)&&Number(order?.gift_card_discount||0)>0;
  }
  function patch(){
    if(typeof window.canCancel!=='function'||typeof window.renderOrders!=='function')return false;
    if(window.canCancel.__promotionAware)return true;
    const base=window.canCancel;
    const promotionAware=function(order){return eligible(order)||base(order)};
    promotionAware.__promotionAware=true;
    window.canCancel=promotionAware;
    window.renderOrders();
    return true;
  }
  if(!patch()){
    let attempts=0;
    const timer=setInterval(()=>{attempts++;if(patch()||attempts>=50)clearInterval(timer)},100);
  }
})();
(()=>{'use strict';
  function eligibleGiftCardCancellation(order){
    const status=String(order?.status||'').toLowerCase();
    const fulfillment=String(order?.fulfillment_status||'ordered').toLowerCase();
    return order?.payment_method==='prepaid'&&status==='paid'&&['ordered','packed'].includes(fulfillment)&&Number(order?.gift_card_discount||0)>0;
  }

  function patchCancellationRules(){
    if(typeof cancellation!=='function'||typeof openCancellation!=='function')return false;
    if(cancellation.__promotionRestorePatched)return true;

    const baseCancellation=cancellation;
    cancellation=function(order){
      const result=baseCancellation(order);
      if(eligibleGiftCardCancellation(order)){
        return{
          available:true,
          note:'Eligible online-payment value will return to the original payment method, and the used gift-card amount will be restored to the same gift card. Delivery below ₹299 remains non-refundable.'
        };
      }
      return result;
    };
    cancellation.__promotionRestorePatched=true;

    const baseOpenCancellation=openCancellation;
    openCancellation=function(order){
      baseOpenCancellation(order);
      if(!eligibleGiftCardCancellation(order))return;
      const preview=document.getElementById('refundPreview');
      if(!preview||preview.querySelector('[data-gift-restore-row]'))return;
      const total=preview.querySelector('.row.total');
      const row=document.createElement('div');
      row.className='row green';
      row.setAttribute('data-gift-restore-row','true');
      row.innerHTML='<span>Gift card balance restoration</span><span>+ '+money(Number(order.gift_card_discount||0))+'</span>';
      if(total)preview.insertBefore(row,total);else preview.appendChild(row);
      const note=preview.querySelector('.preview-note');
      if(note)note.textContent='Eligible online-payment value will return to the original payment method. The used gift-card amount will be restored separately to the same gift card.';
    };
    return true;
  }

  function patchRenderedAction(){
    if(typeof loadedOrder==='undefined'||!loadedOrder||!eligibleGiftCardCancellation(loadedOrder))return false;
    const actions=document.querySelector('#actionsSection .action-list');
    if(!actions)return false;
    let button=document.getElementById('cancelOrderBtn');
    if(!button){
      const disabled=[...actions.querySelectorAll('button.btn.danger')].find(el=>el.disabled);
      if(!disabled)return false;
      button=document.createElement('button');
      button.className='btn danger';
      button.id='cancelOrderBtn';
      button.type='button';
      button.textContent='Cancel order';
      disabled.replaceWith(button);
    }
    button.disabled=false;
    button.onclick=()=>openCancellation(loadedOrder);
    const note=actions.querySelector('.action-note');
    if(note)note.textContent=cancellation(loadedOrder).note;
    if(typeof loadedCancel!=='undefined')loadedCancel=cancellation(loadedOrder);
    return true;
  }

  patchCancellationRules();
  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    patchCancellationRules();
    if(patchRenderedAction()||attempts>=50)clearInterval(timer);
  },100);
})();
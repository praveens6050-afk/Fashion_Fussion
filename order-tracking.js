(function(){
  const STEPS=['ordered','packed','shipped','out_for_delivery','delivered'];
  const LABELS={ordered:'Ordered',packed:'Packed',shipped:'Shipped',out_for_delivery:'Out for Delivery',delivered:'Delivered',cancelled:'Cancelled'};

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
  function label(v){return LABELS[v]||String(v||'Ordered').replace(/_/g,' ');}
  function timeline(status){
    status=String(status||'ordered').toLowerCase();
    if(status==='cancelled') return '<div class="ff-track-cancelled">Order Cancelled</div>';
    let current=STEPS.indexOf(status); if(current<0) current=0;
    return '<div class="ff-track" aria-label="Order tracking">'+STEPS.map((s,i)=>
      '<div class="ff-track-step '+(i<=current?'done':'')+(i===current?' current':'')+'"><span class="ff-track-dot">'+(i<current?'✓':i+1)+'</span><span>'+esc(label(s))+'</span></div>'
    ).join('')+'</div>';
  }

  function enhance(){
    document.querySelectorAll('.order').forEach(card=>{
      if(card.dataset.ffTracking==='1') return;
      const statusEl=card.querySelector('.order-status');
      if(!statusEl) return;
      let status=String(statusEl.textContent||'ordered').trim().toLowerCase().replace(/\s+/g,'_');
      if(status==='paid'||status==='verified'||status==='created') status='ordered';
      // Prefer the dedicated fulfillment status inserted by account rendering.
      if(card.dataset.fulfillmentStatus) status=card.dataset.fulfillmentStatus;
      statusEl.textContent=label(status);
      card.insertAdjacentHTML('beforeend',timeline(status));
      card.dataset.ffTracking='1';
    });
  }

  const style=document.createElement('style');
  style.textContent=`
    .ff-track{display:flex;align-items:flex-start;margin-top:18px;padding-top:16px;border-top:1px solid #eee;overflow-x:auto}
    .ff-track-step{position:relative;min-width:120px;flex:1;text-align:center;color:#9e9e9e;font-size:11px;font-weight:700;padding:0 5px}
    .ff-track-step:not(:last-child):before{content:"";position:absolute;top:11px;left:50%;width:100%;height:3px;background:#e0e0e0;z-index:0}
    .ff-track-step.done:not(:last-child):before{background:#26a541}
    .ff-track-dot{position:relative;z-index:1;width:25px;height:25px;margin:0 auto 7px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#e0e0e0;color:#757575;font-size:11px}
    .ff-track-step.done{color:#212121}.ff-track-step.done .ff-track-dot{background:#26a541;color:white}.ff-track-step.current .ff-track-dot{box-shadow:0 0 0 4px #e8f5e9}
    .ff-track-cancelled{margin-top:16px;padding:11px 13px;border-radius:5px;background:#ffebee;color:#c62828;font-size:12px;font-weight:700}
    @media(max-width:700px){.ff-track-step{min-width:95px;font-size:10px}}
  `;
  document.head.appendChild(style);
  new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',enhance); else enhance();
  window.FashionFussionOrderTracking={enhance,label};
})();
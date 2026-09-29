// Geometry assertions catch hidden overflow even when overflow-x:hidden masks it.
(function () {
  const report = document.createElement('pre');
  report.id = 'ui-regression-report';
  report.setAttribute('aria-live','polite');
  document.body.appendChild(report);
  function check() {
    const failures=[];
    const assert=(ok,label)=>{if(!ok)failures.push(label);};
    const width=document.documentElement.clientWidth;
    const mobile=innerWidth<=900;
    const box=selector=>document.querySelector(selector)?.getBoundingClientRect();
    const fits=selector=>document.querySelectorAll(selector).forEach(el=>{
      if(!el.getClientRects().length)return;
      const rect=el.getBoundingClientRect();
      assert(rect.left>=-1 && rect.right<=width+1, selector+' must fit viewport');
      assert(el.scrollWidth<=el.clientWidth+1, selector+' must not clip its content');
    });
    const layout=box('.layout');
    if(location.pathname.includes('cart')) {
      const items=box('.layout>section'),cart=box('#cart'),summary=box('.summary');
      assert(!!box('.item'),'cart fixture must render an item');
      if(mobile)assert(summary.top>=cart.bottom,'cart summary must stack below items');
      else assert(summary.left>=items.right,'desktop cart must retain side summary');
      fits('.layout>section,.summary,.item,.qty,.controls,.name,#place');
    }
    if(location.pathname.includes('search')) {
      const filters=box('.filters'),results=box('.results');
      assert(document.querySelectorAll('.product').length===2,'search fixture must render both products');
      if(mobile)assert(results.top>=filters.bottom,'search results must stack below filters');
      else assert(results.left>=filters.right,'desktop search must retain side filters');
      fits('.results,.product,.body,.name,.sort,.add');
    }
    if(location.pathname.includes('account')) {
      for(const view of ['returns','business']){
        assert(document.querySelectorAll('[data-view="'+view+'"]').length===1,view+' navigation must be unique');
        assert(document.querySelectorAll('#'+view+'View').length===1,view+' panel must be unique');
      }
      assert(!document.querySelector('#app').hidden,'account fixture must finish loading');
      fits('.layout>section,.side,.panel,.main-title,.order,.order-body,.order-actions,.pname,.address-card,.address-actions');
      const main=box('.layout>section'),side=box('.side');
      if(mobile)assert(main.top>=side.bottom,'account content must stack below navigation');
      else assert(main.left>=side.right,'desktop account must retain sidebar');
    }
    assert(layout?.width>0,'layout must be visible');
    report.textContent=(failures.length?'FAIL':'PASS')+' '+innerWidth+'px '+location.pathname+'\n'+failures.join('\n');
    report.dataset.result=failures.length?'fail':'pass';
  }
  window.addEventListener('load',check);
  window.addEventListener('resize',check);
  document.addEventListener('click',()=>setTimeout(check,200));
  setTimeout(check,600);
})();

(()=>{'use strict';
function activate(view){
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+view));
  document.querySelectorAll('.nav-item[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
  if(view==='products')document.getElementById('productSearch')?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'smooth'});
}
function openProductDrawer(){
  const form=document.getElementById('productForm');
  if(form)form.reset();
  const title=document.getElementById('drawerTitle');
  if(title)title.textContent='Add product';
  const submit=document.getElementById('submitProduct');
  if(submit)submit.textContent='Submit for review';
  const backdrop=document.getElementById('drawerBackdrop');
  if(backdrop)backdrop.hidden=false;
  const drawer=document.getElementById('productDrawer');
  if(drawer){drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');}
}
function bind(){
  document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
    if(btn.dataset.view==='support-live')return;
    btn.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();activate(btn.dataset.view)},true);
  });
  document.querySelectorAll('[data-action="add-product"]').forEach(btn=>{
    btn.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();openProductDrawer()},true);
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
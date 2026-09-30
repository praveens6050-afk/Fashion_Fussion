(function(){
'use strict';
let snapshot=null;
function byId(id){return document.getElementById(id)}
function ensureCancel(){
  const save=byId('saveProfile'),edit=byId('editProfile');
  if(!save||!edit)return false;
  let cancel=byId('cancelProfile');
  if(!cancel){cancel=document.createElement('button');cancel.id='cancelProfile';cancel.className='btn';cancel.type='button';cancel.textContent='Cancel';save.before(cancel);}
  edit.addEventListener('click',()=>{snapshot={fullName:byId('fullName')?.value||'',phone:byId('phone')?.value||''};cancel.hidden=false;},{capture:true});
  cancel.addEventListener('click',()=>{
    if(snapshot){byId('fullName').value=snapshot.fullName;byId('phone').value=snapshot.phone;}
    byId('fullName').readOnly=true;byId('phone').readOnly=true;save.hidden=true;cancel.hidden=true;edit.hidden=false;byId('profileStatus').textContent='';
  });
  const form=byId('profileForm');
  form?.addEventListener('submit',()=>{cancel.hidden=true;});
  cancel.hidden=true;
  return true;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureCancel,{once:true});else ensureCancel();
})();

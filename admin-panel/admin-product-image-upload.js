'use strict';
(()=>{
  if(window.__ffAdminProductImageUpload)return;
  window.__ffAdminProductImageUpload=true;
  const client=window.supabaseClient;
  if(!client)return;
  const BUCKET='product-images',MAX_SIZE=5*1024*1024;
  const cleanName=name=>String(name||'image').toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-90)||'image';
  function flash(msg,type='ok'){
    const status=document.getElementById('status');
    if(status){status.textContent=msg;status.className='status show '+type;setTimeout(()=>{if(status.textContent===msg)status.className='status'},4000)}
  }
  function setBusy(busy){
    const save=document.getElementById('saveProduct');
    if(!save)return;
    if(!save.dataset.uploadIdleText)save.dataset.uploadIdleText=save.textContent||'Save Product';
    save.disabled=Boolean(busy);
    save.textContent=busy?'Uploading image…':save.dataset.uploadIdleText;
    save.setAttribute('aria-busy',busy?'true':'false');
  }
  async function upload(file){
    if(!file?.type?.startsWith('image/'))throw new Error('Please select an image file.');
    if(file.size>MAX_SIZE)throw new Error('Image must be 5 MB or smaller.');
    const {data:{session},error:sessionError}=await client.auth.getSession();
    if(sessionError||!session?.user)throw new Error('Please sign in again before uploading an image.');
    const uid=session.user.id,ext=cleanName(file.name).split('.').pop(),suffix=/^[a-z0-9]{2,8}$/.test(ext)?'.'+ext:'';
    const path=`admin/${uid}/${Date.now()}-${crypto.randomUUID()}${suffix}`;
    const {error}=await client.storage.from(BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
    if(error)throw error;
    const {data}=client.storage.from(BUCKET).getPublicUrl(path);
    if(!data?.publicUrl)throw new Error('Uploaded image URL could not be created.');
    return data.publicUrl;
  }
  function install(){
    const hidden=document.getElementById('imageUrl');
    if(!hidden||document.getElementById('adminProductImageFile'))return;
    const group=hidden.closest('.group')||hidden.parentElement;if(!group)return;
    hidden.type='hidden';hidden.removeAttribute('placeholder');
    const label=group.querySelector('label');if(label)label.textContent='Product image';
    const file=document.createElement('input');file.type='file';file.accept='image/*';file.id='adminProductImageFile';file.setAttribute('aria-label','Product image');group.appendChild(file);
    const help=document.createElement('small');help.id='adminProductImageStatus';help.className='admin-image-help';help.textContent='Choose an image file. Max 5 MB.';group.appendChild(help);
    file.addEventListener('change',async()=>{
      const selected=file.files?.[0];if(!selected)return;
      file.disabled=true;setBusy(true);help.textContent='Uploading '+selected.name+'…';
      try{hidden.value=await upload(selected);help.textContent='Uploaded: '+selected.name;flash('Product image uploaded.');}
      catch(error){file.value='';help.textContent='Upload failed. Choose the image again.';flash(error.message||'Image upload failed.','err')}
      finally{file.disabled=false;setBusy(false)}
    });
    document.getElementById('addProductButton')?.addEventListener('click',()=>setTimeout(()=>{file.value='';help.textContent='Choose an image file. Max 5 MB.';setBusy(false)},0));
    document.getElementById('productsTable')?.addEventListener('click',event=>{if(event.target.closest?.('[data-edit]'))setTimeout(()=>{file.value='';help.textContent=hidden.value?'Current image will be kept unless you choose a new file.':'Choose an image file. Max 5 MB.';setBusy(false)},0)},true);
  }
  install();
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();

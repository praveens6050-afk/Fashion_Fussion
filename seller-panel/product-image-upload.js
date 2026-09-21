'use strict';
(()=>{
  if(window.__ffSellerProductImageUpload)return;
  window.__ffSellerProductImageUpload=true;
  const client=window.supabaseClient;
  if(!client)return;
  const BUCKET='product-images';
  const MAX_SIZE=5*1024*1024;
  const MAX_ADDITIONAL=5;
  const state={busy:0};
  const notify=msg=>window.SellerCatalogBridge?.notify?.(msg)||console.warn(msg);
  const cleanName=name=>String(name||'image').toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-90)||'image';
  function validFile(file){
    if(!file?.type?.startsWith('image/')){notify('Please select an image file.');return false}
    if(file.size>MAX_SIZE){notify('Each image must be 5 MB or smaller.');return false}
    return true;
  }
  async function userId(){
    const {data:{session},error}=await client.auth.getSession();
    if(error||!session?.user)throw new Error('Please sign in again before uploading an image.');
    return session.user.id;
  }
  async function upload(file,index=0){
    if(!validFile(file))throw new Error('Invalid image file.');
    const uid=await userId();
    const ext=cleanName(file.name).split('.').pop();
    const suffix=/^[a-z0-9]{2,8}$/.test(ext)?'.'+ext:'';
    const path=`seller/${uid}/${Date.now()}-${crypto.randomUUID()}-${index}${suffix}`;
    state.busy++;
    try{
      const {error}=await client.storage.from(BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
      if(error)throw error;
      const {data}=client.storage.from(BUCKET).getPublicUrl(path);
      if(!data?.publicUrl)throw new Error('Uploaded image URL could not be created.');
      return data.publicUrl;
    }finally{state.busy--}
  }
  function statusNode(id,anchor){
    let el=document.getElementById(id);
    if(el)return el;
    el=document.createElement('small');el.id=id;el.className='field-help';el.style.display='block';el.style.marginTop='6px';
    anchor.insertAdjacentElement('afterend',el);return el;
  }
  function installPrimary(){
    const hidden=document.getElementById('image');
    if(!hidden||document.getElementById('primaryImageFile'))return;
    const label=hidden.closest('label');
    if(!label)return;
    hidden.type='hidden';hidden.removeAttribute('required');hidden.removeAttribute('placeholder');
    const title=document.createElement('span');title.textContent='Primary product image';
    const file=document.createElement('input');file.id='primaryImageFile';file.type='file';file.accept='image/*';file.setAttribute('aria-label','Primary product image');
    label.insertBefore(title,hidden);label.appendChild(file);
    const status=statusNode('primaryImageUploadStatus',file);
    file.addEventListener('change',async()=>{
      const selected=file.files?.[0];if(!selected)return;
      status.textContent='Uploading image…';file.disabled=true;
      try{const url=await upload(selected);hidden.value=url;hidden.dispatchEvent(new Event('input',{bubbles:true}));status.textContent='Image uploaded successfully.';notify('Primary image uploaded.');}
      catch(error){file.value='';status.textContent='Upload failed.';notify(error.message||'Image upload failed.');}
      finally{file.disabled=false}
    });
  }
  function installAdditional(){
    const hidden=document.getElementById('additionalImages');
    if(!hidden||document.getElementById('additionalImageFiles'))return;
    const label=hidden.closest('label');if(!label)return;
    hidden.style.display='none';hidden.setAttribute('aria-hidden','true');
    const originalText=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);if(originalText)originalText.textContent='Additional product images (optional)';
    const file=document.createElement('input');file.id='additionalImageFiles';file.type='file';file.accept='image/*';file.multiple=true;file.setAttribute('aria-label','Additional product images');
    label.appendChild(file);
    const status=statusNode('additionalImageUploadStatus',file);
    file.addEventListener('change',async()=>{
      const files=[...(file.files||[])];if(!files.length)return;
      if(files.length>MAX_ADDITIONAL){notify(`Select a maximum of ${MAX_ADDITIONAL} additional images.`);file.value='';return}
      if(files.some(f=>!validFile(f))){file.value='';return}
      status.textContent=`Uploading ${files.length} image${files.length===1?'':'s'}…`;file.disabled=true;
      try{const urls=[];for(let i=0;i<files.length;i++)urls.push(await upload(files[i],i+1));hidden.value=urls.join('\n');hidden.dispatchEvent(new Event('input',{bubbles:true}));status.textContent=`${urls.length} additional image${urls.length===1?'':'s'} uploaded.`;notify('Additional images uploaded.');}
      catch(error){file.value='';status.textContent='Upload failed.';notify(error.message||'Additional image upload failed.');}
      finally{file.disabled=false}
    });
  }
  function install(){installPrimary();installAdditional()}
  install();
  const observer=new MutationObserver(install);observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-action="add-product"],[data-edit]'))setTimeout(()=>{const p=document.getElementById('primaryImageFile'),a=document.getElementById('additionalImageFiles');if(p)p.value='';if(a)a.value='';const ps=document.getElementById('primaryImageUploadStatus'),as=document.getElementById('additionalImageUploadStatus');if(ps)ps.textContent=document.getElementById('image')?.value?'Current uploaded image will be kept unless you select a new one.':'';if(as)as.textContent=document.getElementById('additionalImages')?.value?'Current additional images will be kept unless you select new files.':'';},60)},true);
})();

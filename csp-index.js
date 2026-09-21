'use strict';
const CART_KEY='fashion_fussion_cart';
let allProducts=[],wishlistIds=new Set(),currentUser=null,adminPreview=false;
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});

function toast(m){const e=$('toast');if(!e)return;e.textContent=m;e.classList.add('show');clearTimeout(window.__t);window.__t=setTimeout(()=>e.classList.remove('show'),1800)}
function cart(){try{return JSON.parse(localStorage.getItem(CART_KEY)||'{}')||{}}catch{return{}}}
function saveCart(c){localStorage.setItem(CART_KEY,JSON.stringify(c));sessionStorage.removeItem('fashion_fussion_checkout_key');updateCartCount()}
function updateCartCount(){const el=$('cartCount');if(el)el.textContent=Object.values(cart()).reduce((s,q)=>s+Math.max(0,Number(q)||0),0)}
function addToCart(id){const c=cart();c[id]=Math.min(500,Math.max(0,Number(c[id])||0)+1);saveCart(c);toast('Added to cart')}

async function loadSession(){
  const{data:{user}}=await window.supabaseClient.auth.getUser();
  currentUser=user||null;
  const accountLink=$('accountLink'),accountText=$('accountText'),accountGreeting=$('accountGreeting');
  if(accountLink)accountLink.href=currentUser?'account.html#orders':'login.html';
  if(accountText)accountText.textContent=currentUser?'My Account':'Account';
  let profile=null;
  if(currentUser){
    const{data:p,error}=await window.supabaseClient.from('profiles').select('full_name,is_admin').eq('id',currentUser.id).maybeSingle();
    if(!error)profile=p;
    const fullName=String(profile?.full_name||currentUser.user_metadata?.full_name||currentUser.user_metadata?.name||'').trim();
    const firstName=fullName.split(/\s+/)[0]||String(currentUser.email||'').split('@')[0]||'Customer';
    if(accountGreeting){accountGreeting.textContent='Hello, '+firstName;accountGreeting.title=fullName||firstName;}
    if(accountLink)accountLink.setAttribute('aria-label','My Account for '+firstName);
  }else{
    if(accountGreeting){accountGreeting.textContent='Hello, sign in';accountGreeting.removeAttribute('title');}
    if(accountLink)accountLink.setAttribute('aria-label','Sign in or open account');
  }
  adminPreview=new URLSearchParams(location.search).get('admin_preview')==='1';
  if(adminPreview&&currentUser)adminPreview=profile?.is_admin===true;else adminPreview=false;
}

async function loadWishlist(){
  wishlistIds.clear();
  if(!currentUser)return;
  const{data,error}=await window.supabaseClient.from('customer_wishlist').select('product_id').eq('user_id',currentUser.id);
  if(!error)(data||[]).forEach(x=>wishlistIds.add(Number(x.product_id)));
}

async function toggleWishlist(id,b){
  if(!currentUser){location.href='login.html';return;}
  b.disabled=true;
  try{
    if(wishlistIds.has(id)){
      const{error}=await window.supabaseClient.from('customer_wishlist').delete().eq('user_id',currentUser.id).eq('product_id',id);
      if(error)throw error;
      wishlistIds.delete(id);
    }else{
      const{error}=await window.supabaseClient.from('customer_wishlist').insert({user_id:currentUser.id,product_id:id});
      if(error&&error.code!=='23505')throw error;
      wishlistIds.add(id);
    }
    b.classList.toggle('saved',wishlistIds.has(id));
    b.textContent=wishlistIds.has(id)?'♥':'♡';
  }catch(e){toast(e.message||'Wishlist could not be updated');}
  finally{b.disabled=false;}
}

function image(p){return p.image_url?'<img data-home-image src="'+esc(p.image_url)+'" alt="'+esc(p.name)+'" loading="lazy">':'<div class="fallback">Image unavailable</div>'}
function bindImageFallbacks(){document.querySelectorAll('[data-home-image]').forEach(img=>img.addEventListener('error',()=>{if(!img.isConnected)return;const fallback=document.createElement('div');fallback.className='fallback';fallback.textContent='Image unavailable';img.replaceWith(fallback)},{once:true}))}
function reviewLine(p){const n=Number(p.reviews||0),r=Number(p.rating||0);return n>0&&r>0?'<div class="social">'+r.toFixed(1)+' / 5 · '+n+' review'+(n===1?'':'s')+'</div>':''}

function render(){
  const rows=allProducts;
  $('gridSub').textContent=rows.length?rows.length+' active product'+(rows.length===1?'':'s'):'No active products are available yet.';
  $('productsGrid').innerHTML=rows.length?rows.map(p=>'<article class="product"><div class="media">'+image(p)+'<a class="media-link" href="product.html?id='+encodeURIComponent(p.id)+'" aria-label="View '+esc(p.name)+'"></a>'+(p.badge?'<span class="badge">'+esc(p.badge)+'</span>':'')+'<button class="heart '+(wishlistIds.has(Number(p.id))?'saved':'')+'" data-wish="'+p.id+'" aria-label="Save '+esc(p.name)+' to wishlist">'+(wishlistIds.has(Number(p.id))?'♥':'♡')+'</button></div><div class="body"><div class="cat">'+esc(p.category||'General')+'</div><div class="name"><a href="product.html?id='+encodeURIComponent(p.id)+'">'+esc(p.name)+'</a></div><div class="desc">'+esc(p.description||'Product from Fashion Fussion.')+'</div>'+reviewLine(p)+'<div class="price-row"><div><div class="price">'+money(p.price)+'</div><div class="gst">Inclusive of applicable taxes</div></div><div class="gst">GST '+Number(p.gst_rate||0)+'%</div></div><div class="product-actions"><button class="add" data-add="'+p.id+'">ADD TO CART</button><a class="details-btn" href="product.html?id='+encodeURIComponent(p.id)+'">DETAILS</a></div></div></article>').join(''):'<div class="empty">No active products are available yet. <a href="search.html">Browse the catalogue</a>.</div>';
  bindImageFallbacks();
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>addToCart(b.dataset.add));
  document.querySelectorAll('[data-wish]').forEach(b=>b.onclick=()=>toggleWishlist(Number(b.dataset.wish),b));
}

function categories(){return['All',...new Set(allProducts.map(p=>String(p.category||'').trim()).filter(Boolean))]}
function categoryUrl(cat){return cat==='All'?'search.html':'search.html?category='+encodeURIComponent(cat)}
function renderCategories(){
  const cats=categories();
  $('chips').innerHTML=cats.map(c=>'<a class="chip" href="'+categoryUrl(c)+'">'+esc(c==='All'?'All products':c)+'</a>').join('');
  $('departmentNav').innerHTML=cats.map(c=>'<a href="'+categoryUrl(c)+'">'+esc(c==='All'?'All Products':c)+'</a>').join('')+'<a href="business-buying.html">Business Buying</a>';
}

async function loadProducts(){
  let q=window.supabaseClient.from('products').select('id,name,description,category,badge,price,rating,reviews,gst_rate,image_url,is_active').order('id',{ascending:true});
  if(!adminPreview)q=q.eq('is_active',true);
  const{data,error}=await q;
  if(error)throw error;
  allProducts=(data||[]).filter(p=>Number(p.price)>=0);
  renderCategories();
  render();
}

function goSearch(){const q=$('searchBox').value.trim();location.href='search.html'+(q?'?q='+encodeURIComponent(q):'')}
$('searchBtn').onclick=goSearch;
$('searchBox').addEventListener('keydown',e=>{if(e.key==='Enter')goSearch()});

function showLoadError(){
  $('gridSub').textContent='Products could not be loaded.';
  const chips=$('chips');if(chips)chips.innerHTML='';
  $('productsGrid').innerHTML='<div class="empty"><strong>Store is temporarily unavailable.</strong><p>Please retry or continue browsing.</p><div class="empty-actions"><button class="btn" id="retryProducts" type="button">Retry</button><a class="btn" href="search.html">Browse catalogue</a></div></div>';
  const retry=$('retryProducts');if(retry)retry.onclick=init;
}

async function init(){
  try{
    updateCartCount();
    if(window.ffSupabaseReady)await window.ffSupabaseReady;
    if(!window.supabaseClient)throw new Error('Store client is unavailable');
    await loadSession();
    await loadWishlist();
    await loadProducts();
  }catch(e){console.error(e);showLoadError();}
}

init();

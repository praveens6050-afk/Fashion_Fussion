'use strict';

(async () => {
  const list = document.getElementById('list');
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\"': '&quot;'
  }[char]));
  const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  const { data: { user }, error: userError } = await window.supabaseClient.auth.getUser();
  if (userError || !user) {
    location.href = 'login.html?redirect=' + encodeURIComponent('wishlist.html');
    return;
  }

  function image(product) {
    return product.image_url
      ? '<img class="pic" data-wishlist-image src="' + esc(product.image_url) + '" alt="' + esc(product.name) + '">'
      : '<div class="fallback">Image unavailable</div>';
  }

  function bindImageFallbacks() {
    list.querySelectorAll('[data-wishlist-image]').forEach(img => img.addEventListener('error', () => {
      if (!img.isConnected) return;
      const fallback = document.createElement('div');
      fallback.className = 'fallback';
      fallback.textContent = 'Image unavailable';
      img.replaceWith(fallback);
    }, { once: true }));
  }

  async function load() {
    const { data: rows, error } = await window.supabaseClient
      .from('customer_wishlist')
      .select('id,product_id,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      list.className = 'empty';
      list.textContent = 'Unable to load wishlist.';
      return;
    }
    if (!rows?.length) {
      list.className = 'empty';
      list.innerHTML = '<h2>Your Wishlist is empty</h2><p>Use the heart on a product to save it here.</p><a class="btn" href="search.html">Browse products</a>';
      return;
    }

    const ids = rows.map(row => row.product_id);
    const { data: products, error: productError } = await window.supabaseClient
      .from('products')
      .select('id,name,category,price,image_url,is_active,gst_rate')
      .in('id', ids);

    if (productError) {
      list.className = 'empty';
      list.textContent = 'Unable to load saved products.';
      return;
    }

    const map = new Map((products || []).map(product => [Number(product.id), product]));
    list.className = '';
    list.innerHTML = rows.map(row => {
      const product = map.get(Number(row.product_id));
      if (!product) {
        return '<div class="card"><div class="fallback">Removed product</div><div><div class="name">Product unavailable</div><div class="meta">This saved product no longer exists.</div></div><div class="actions"><button class="btn remove" data-remove="' + row.product_id + '">REMOVE</button></div></div>';
      }
      return '<div class="card">' + image(product) + '<div><a class="name" href="product.html?id=' + encodeURIComponent(product.id) + '">' + esc(product.name) + '</a><div class="meta">' + esc(product.category || 'General') + ' · GST ' + Number(product.gst_rate || 0) + '%</div><div class="price">' + money(product.price) + '</div></div><div class="actions"><a class="btn details" href="product.html?id=' + encodeURIComponent(product.id) + '">DETAILS</a><button class="btn" data-add="' + product.id + '" ' + (!product.is_active ? 'disabled' : '') + '>' + (product.is_active ? 'ADD TO CART' : 'UNAVAILABLE') + '</button><button class="btn remove" data-remove="' + product.id + '">REMOVE</button></div></div>';
    }).join('');

    bindImageFallbacks();
    // Add-to-cart clicks are handled centrally by catalog-cart-entry.js so wishlist
    // products follow the same variant availability rules as search and homepage.
    list.querySelectorAll('[data-remove]').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        const { error: removeError } = await window.supabaseClient
          .from('customer_wishlist')
          .delete()
          .eq('user_id', user.id)
          .eq('product_id', Number(button.dataset.remove));
        if (removeError) {
          alert(removeError.message);
          button.disabled = false;
        } else {
          load();
        }
      };
    });
  }

  await load();
})().catch(error => {
  console.error(error);
  document.getElementById('list').textContent = 'Wishlist could not be loaded.';
});

'use strict';

const KEY = 'fashion_fussion_cart';
const LINE_KEY = 'fashion_fussion_cart_lines_v2';
const BACKEND_URL = window.FF_API_ORIGIN || '';
let cart = {};
let products = [];
let session = null;
let serverQuote = null;
let quoteSeq = 0;
let quoteTimer = null;

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}[char]));
const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function parseObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function loadCart() {
  const legacy = parseObject(KEY);
  let lines = [];
  try {
    const value = JSON.parse(localStorage.getItem(LINE_KEY) || '[]');
    if (Array.isArray(value)) lines = value;
  } catch {}

  const aggregate = {};
  for (const line of lines) {
    const id = Number(line?.id);
    const qty = Number(line?.qty);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(qty) || qty <= 0) continue;
    aggregate[id] = Math.min(500, (Number(aggregate[id]) || 0) + qty);
  }

  cart = { ...legacy };
  for (const [id, qty] of Object.entries(aggregate)) cart[id] = qty;
  for (const [id, qty] of Object.entries(cart)) {
    const normalized = Math.min(500, Math.max(0, Math.floor(Number(qty) || 0)));
    if (normalized) cart[id] = normalized;
    else delete cart[id];
  }
  localStorage.setItem(KEY, JSON.stringify(cart));
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(cart));
  sessionStorage.removeItem('fashion_fussion_checkout_key');
  serverQuote = null;
  scheduleQuote();
}

function localTotals() {
  let subtotal = 0;
  let gst = 0;
  let count = 0;
  products.forEach(product => {
    const qty = Number(cart[product.id] || 0);
    const value = Number(product.price || 0) * qty;
    subtotal += value;
    gst += value * Number(product.gst_rate || 0) / 100;
    count += qty;
  });
  const delivery = subtotal ? (subtotal >= 299 ? 0 : 49) : 0;
  return {
    subtotal,
    gst,
    delivery,
    total: subtotal + gst + delivery,
    count,
    remaining: Math.max(0, 299 - subtotal)
  };
}

function currentTotals() {
  if (!serverQuote) return localTotals();
  const local = localTotals();
  return {
    subtotal: Number(serverQuote.subtotal || 0),
    gst: Number(serverQuote.gst_total ?? serverQuote.gst ?? 0),
    delivery: Number(serverQuote.delivery || 0),
    total: Number(serverQuote.total || 0),
    count: local.count,
    remaining: Number(serverQuote.amount_to_delivery_benefit ?? Math.max(0, 299 - Number(serverQuote.subtotal || 0)))
  };
}

function renderPrices() {
  const totals = currentTotals();
  const verified = Boolean(serverQuote);
  $('cartSub').textContent = totals.count
    ? totals.count + ' item' + (totals.count === 1 ? '' : 's') + ' in your cart.'
    : 'Your cart is empty.';

  $('prices').innerHTML =
    '<div class="rows">' +
      '<div class="row"><span>Product subtotal</span><span>' + money(totals.subtotal) + '</span></div>' +
      '<div class="row"><span>Applicable GST</span><span>' + money(totals.gst) + '</span></div>' +
      '<div class="row"><span>Delivery</span><span class="' + (!totals.delivery ? 'free' : '') + '">' +
        (totals.subtotal ? (!totals.delivery ? 'FREE' : money(totals.delivery)) : '₹0') +
      '</span></div>' +
    '</div>' +
    '<div class="total"><span>' + (verified ? 'Payable before offers' : 'Estimated payable') + '</span><span>' + money(totals.total) + '</span></div>' +
    (totals.subtotal
      ? '<div class="delivery-note ' + (!totals.delivery ? 'good' : '') + '">' +
          (!totals.delivery
            ? '✓ ₹299 delivery benefit unlocked for this order.'
            : 'Add ' + money(totals.remaining) + ' more in product value to unlock the ₹299 delivery benefit. ₹49 delivery below ₹299 is non-refundable under the current store policy.') +
        '</div>'
      : '');
}

function image(product) {
  return product.image_url
    ? '<img class="pic" data-cart-image src="' + esc(product.image_url) + '" alt="' + esc(product.name) + '">'
    : '<div class="fallback">Image unavailable</div>';
}

function bindImageFallbacks() {
  document.querySelectorAll('[data-cart-image]').forEach(img => img.addEventListener('error', () => {
    if (!img.isConnected) return;
    const fallback = document.createElement('div');
    fallback.className = 'fallback';
    fallback.textContent = 'Image unavailable';
    img.replaceWith(fallback);
  }, { once: true }));
}

function render() {
  products = products.filter(product => Number(cart[product.id] || 0) > 0);
  const box = $('cart');
  if (!products.length) {
    box.innerHTML = '<div class="empty"><h2>Your cart is empty</h2><div>Add products to continue shopping.</div><br><a class="btn" href="index.html#products">Shop products</a></div>';
    $('place').disabled = true;
    $('verifyBox').textContent = 'No items to verify.';
    $('verifyBox').className = 'verify';
    renderPrices();
    return;
  }

  box.innerHTML = products.map(product => {
    const qty = Math.min(500, Math.max(1, Number(cart[product.id]) || 1));
    const price = Number(product.price || 0);
    const lineTotal = price * qty;
    return '<article class="item">' + image(product) +
      '<div><div class="name"><a href="product.html?id=' + encodeURIComponent(product.id) + '">' + esc(product.name) + '</a></div>' +
      '<div class="meta">' + esc(product.category || 'General') + ' · GST ' + Number(product.gst_rate || 0) + '%</div>' +
      '<div class="unit">' + money(price) + ' / piece</div>' +
      (qty >= 10 ? '<div class="bulk">LARGER QUANTITY · ' + qty + ' PCS</div>' : '') +
      '<div class="controls"><div class="qty"><button data-dec="' + product.id + '">−</button>' +
      '<input data-qty="' + product.id + '" type="number" min="1" max="500" value="' + qty + '">' +
      '<button data-inc="' + product.id + '">+</button></div>' +
      '<button class="remove" data-remove="' + product.id + '">REMOVE</button></div></div>' +
      '<div><div class="line-total">' + money(lineTotal) + '</div><div class="line-gst">before applicable GST</div></div></article>';
  }).join('');

  bindImageFallbacks();
  box.querySelectorAll('[data-inc]').forEach(button => {
    button.onclick = () => change(button.dataset.inc, 1);
  });
  box.querySelectorAll('[data-dec]').forEach(button => {
    button.onclick = () => change(button.dataset.dec, -1);
  });
  box.querySelectorAll('[data-qty]').forEach(input => {
    input.onchange = () => setQuantity(input.dataset.qty, input.value);
  });
  box.querySelectorAll('[data-remove]').forEach(button => {
    button.onclick = () => remove(button.dataset.remove);
  });
  $('place').disabled = false;
  renderPrices();
}

function change(id, delta) {
  const next = Math.max(0, Math.min(500, Number(cart[id] || 0) + delta));
  if (!next) delete cart[id];
  else cart[id] = next;
  save();
  render();
}

function setQuantity(id, value) {
  cart[id] = Math.min(500, Math.max(1, Math.floor(Number(value) || 1)));
  save();
  render();
}

function remove(id) {
  delete cart[id];
  save();
  render();
}

function quoteItems() {
  return Object.entries(cart)
    .map(([id, qty]) => ({ id: Number(id), qty: Number(qty) }))
    .filter(item => Number.isInteger(item.id) && Number.isInteger(item.qty) && item.qty > 0 && item.qty <= 500);
}

function scheduleQuote() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(refreshQuote, 180);
}

async function refreshQuote() {
  const seq = ++quoteSeq;
  const items = quoteItems();
  if (!items.length) {
    serverQuote = null;
    renderPrices();
    return;
  }

  const { data: { session: fresh } } = await supabaseClient.auth.getSession();
  session = fresh || null;
  if (!session?.access_token) {
    serverQuote = null;
    $('verifyBox').textContent = 'Sign in to verify cart totals before checkout.';
    $('verifyBox').className = 'verify';
    renderPrices();
    return;
  }

  $('verifyBox').textContent = 'Verifying current pricing with checkout…';
  $('verifyBox').className = 'verify';
  try {
    const response = await fetch(BACKEND_URL + '/api/quote-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({ items, payment_method: 'prepaid' })
    });
    const data = await response.json().catch(() => ({}));
    if (seq !== quoteSeq) return;
    if (!response.ok) throw new Error(data.error || 'Unable to verify pricing');
    serverQuote = data.pricing || null;
    $('verifyBox').textContent = '✓ Pricing verified by checkout backend';
    $('verifyBox').className = 'verify ok';
    renderPrices();
  } catch (error) {
    if (seq !== quoteSeq) return;
    serverQuote = null;
    $('verifyBox').textContent = 'Could not verify now — checkout will recalculate securely.';
    $('verifyBox').className = 'verify err';
    renderPrices();
    console.error(error);
  }
}

async function loadAddress() {
  const { data: { session: fresh } } = await supabaseClient.auth.getSession();
  session = fresh || null;
  if (!session) {
    $('address').innerHTML = '<div><b>Sign in to use your saved delivery address</b><div class="muted">You can also continue and sign in during checkout.</div></div><a class="btn" href="login.html?redirect=checkout">Sign in</a>';
    return;
  }

  const { data: address } = await supabaseClient
    .from('customer_addresses')
    .select('id,label,full_name,postal_code,address_line1,city,state')
    .eq('user_id', session.user.id)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();

  $('address').innerHTML = address
    ? '<div><b>Deliver to ' + esc(address.full_name) + ', ' + esc(address.postal_code) + '</b><div class="muted">' + esc(address.address_line1) + ', ' + esc(address.city) + ', ' + esc(address.state) + '</div></div><a class="btn" href="checkout.html#address">Change in checkout</a>'
    : '<div><b>No default delivery address selected</b><div class="muted">Add or choose your address during checkout.</div></div><a class="btn" href="checkout.html#address">Add in checkout</a>';
}

async function init() {
  await (window.ffSupabaseReady || Promise.resolve(window.supabaseClient));
  loadCart();
  const ids = Object.keys(cart).map(Number).filter(Number.isInteger);
  if (ids.length) {
    const { data, error } = await supabaseClient
      .from('products')
      .select('id,name,category,price,image_url,gst_rate,is_active')
      .in('id', ids)
      .eq('is_active', true);
    if (error) throw error;
    products = data || [];
  }
  await loadAddress();
  render();
  await refreshQuote();
}

$('place').onclick = () => {
  location.href = 'checkout.html';
};

init().catch(error => {
  console.error(error);
  $('cart').innerHTML = '<div class="empty"><h2>Cart could not be loaded</h2><div>Please refresh and try again.</div></div>';
});

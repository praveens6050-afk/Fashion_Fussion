(function(){
'use strict';

const BACKEND_URL = window.FF_API_ORIGIN || '';
const CART_KEY = 'fashion_fussion_cart';
const CHECKOUT_KEY = 'fashion_fussion_checkout_key';
const PAYU_PENDING_KEY = 'fashion_fussion_payu_pending_order';
let payuActive = false;
let busy = false;

function safe(error, fallback) {
  return window.ffCustomerMessage ? window.ffCustomerMessage(error, fallback) : (error?.message || fallback);
}

function setStatus(message, type = 'error') {
  const el = document.getElementById('checkoutStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'status' + (message ? ' show ' + type : '');
}

function checkoutKey() {
  let key = sessionStorage.getItem(CHECKOUT_KEY);
  if (key) return key;
  key = globalThis.crypto?.randomUUID?.() || ('ff_' + Date.now() + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  sessionStorage.setItem(CHECKOUT_KEY, key);
  return key;
}

function cartItems() {
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch {}
  return Object.entries(cart)
    .map(([id, qty]) => ({ id: Number(id), qty: Number(qty) }))
    .filter(item => Number.isInteger(item.id) && Number.isInteger(item.qty) && item.qty > 0 && item.qty <= 500);
}

function appliedPromo(inputId, messageId) {
  const input = document.getElementById(inputId);
  const message = document.getElementById(messageId);
  if (!input || !message || !/applied successfully/i.test(String(message.textContent || ''))) return '';
  return String(input.value || '').trim().toUpperCase();
}

async function session() {
  const { data: { session }, error } = await window.supabaseClient.auth.getSession();
  if (error) throw error;
  if (!session?.user) throw new Error('Please sign in again before checkout.');
  return session;
}

async function api(path, body, accessToken) {
  const response = await fetch(BACKEND_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + accessToken
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.data = data;
    throw error;
  }
  return data;
}

function submitPayU(gateway) {
  if (!gateway || gateway.provider !== 'payu' || gateway.method !== 'POST' || !gateway.action || !gateway.fields) {
    throw new Error('PayU checkout could not be prepared.');
  }
  const action = new URL(gateway.action);
  const allowed = action.protocol === 'https:' &&
    ['secure.payu.in', 'test.payu.in'].includes(action.hostname) &&
    action.pathname === '/_payment';
  if (!allowed) throw new Error('Unexpected PayU payment destination.');

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action.toString();
  form.style.display = 'none';
  form.acceptCharset = 'UTF-8';
  Object.entries(gateway.fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value == null ? '' : String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

async function payWithPayU() {
  if (busy) return;
  const btn = document.getElementById('continueBtn');
  const items = cartItems();
  const addressId = document.querySelector('input[name="deliveryAddress"]:checked')?.value;
  if (!items.length || !/^\d+$/.test(String(addressId || ''))) {
    setStatus('Please confirm your cart and delivery address before payment.');
    return;
  }

  busy = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'PREPARING PAYU...';
  }
  setStatus('Preparing your secure PayU checkout…', 'ok');

  try {
    const currentSession = await session();
    const { data: profile, error } = await window.supabaseClient
      .from('profiles')
      .select('full_name,phone')
      .eq('id', currentSession.user.id)
      .maybeSingle();
    if (error) throw error;

    const selectedAddress = document.querySelector('input[name="deliveryAddress"]:checked')?.closest('.address-option');
    const addressName = selectedAddress?.querySelector('.address-name')?.textContent || '';
    const business = window.FashionFussionBusinessCheckout?.payload?.() || {};
    const body = {
      checkout_key: checkoutKey(),
      items,
      customer_name: String(profile?.full_name || addressName || '').trim(),
      customer_phone: String(profile?.phone || '').trim(),
      shipping_address: { id: Number(addressId) },
      coupon_code: appliedPromo('couponCode', 'couponMsg'),
      gift_card_code: appliedPromo('giftCode', 'giftMsg'),
      payment_method: 'prepaid',
      ...business
    };

    const data = await api('/api/create-payu-order', body, currentSession.access_token);
    if (data.completed) {
      localStorage.removeItem(CART_KEY);
      sessionStorage.removeItem(CHECKOUT_KEY);
      sessionStorage.removeItem(PAYU_PENDING_KEY);
      location.href = 'order-confirmation.html?id=' + encodeURIComponent(data.store_order_id);
      return;
    }
    if (!data.gateway) throw new Error('PayU checkout could not be prepared.');
    sessionStorage.setItem(PAYU_PENDING_KEY, String(data.store_order_id));
    if (btn) btn.textContent = 'REDIRECTING TO PAYU...';
    setStatus('Redirecting to PayU secure payment…', 'ok');
    submitPayU(data.gateway);
  } catch (error) {
    console.error('PayU checkout error:', error);
    if (error.data?.retry_with_new_checkout) {
      sessionStorage.removeItem(CHECKOUT_KEY);
      sessionStorage.removeItem(PAYU_PENDING_KEY);
    }
    setStatus(safe(error, 'Unable to start PayU checkout. Please try again.'));
    busy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'PAY SECURELY';
    }
  }
}

function interceptPayUClick(event) {
  if (!payuActive) return;
  const method = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'prepaid';
  if (method !== 'prepaid') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  payWithPayU();
}

function updatePaymentCopy() {
  const prepaid = document.querySelector('input[name="paymentMethod"][value="prepaid"]')?.closest('.pay-option');
  const note = prepaid?.querySelector('.pay-note');
  if (note) note.textContent = 'UPI, cards, net banking and other available methods through PayU. No payment handling fee.';
}

async function init() {
  const btn = document.getElementById('continueBtn');
  if (!btn || !window.supabaseClient) return;
  try {
    const response = await fetch(BACKEND_URL + '/api/payment-config', { cache: 'no-store' });
    const config = await response.json().catch(() => ({}));
    if (!response.ok || config.provider !== 'payu' || config.payu_ready !== true) return;
    payuActive = true;
    updatePaymentCopy();
    btn.addEventListener('click', interceptPayUClick, true);
  } catch (error) {
    console.warn('PayU provider configuration unavailable; existing payment flow remains active.');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
})();

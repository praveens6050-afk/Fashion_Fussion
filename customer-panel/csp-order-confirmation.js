'use strict';

const esc = value => String(value ?? '').replace(/[&<>\"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\"': '&quot;',
  "'": '&#039;'
}[char]));
const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function usableAddressValue(value) {
  const text = String(value ?? '').trim();
  return text && !/^0+$/.test(text) ? text : '';
}

function addressMarkup(order) {
  const address = order.shipping_address || {};
  const line1 = usableAddressValue(address.address_line1);
  const city = usableAddressValue(address.city);
  const state = usableAddressValue(address.state);
  const postal = usableAddressValue(address.postal_code);
  const name = usableAddressValue(address.full_name) || usableAddressValue(order.customer_name);
  const phone = usableAddressValue(address.phone);
  const country = usableAddressValue(address.country);
  const complete = line1 && city && state && /^\d{6}$/.test(postal);
  if (!complete) {
    return '<div class="address-warning"><strong>Delivery address details are incomplete for this order.</strong><br>Review your saved address in My Account before placing another order.</div>';
  }
  const locality = [city, state].filter(Boolean).join(', ') + (postal ? ' - ' + postal : '');
  return (name ? '<strong>' + esc(name) + '</strong><br>' : '') +
    esc(line1) +
    (usableAddressValue(address.address_line2) ? '<br>' + esc(usableAddressValue(address.address_line2)) : '') +
    (locality ? '<br>' + esc(locality) : '') +
    (country ? '<br>' + esc(country) : '') +
    (phone ? '<br>Phone: ' + esc(phone) : '');
}

function prepaidPaymentState(order) {
  if (String(order.payment_method || '').toLowerCase() !== 'prepaid') return '';
  const status = String(order.status || '').toLowerCase();
  if (order.payment_verified_at || status === 'paid') return '';
  if (['payment_failed', 'failed'].includes(status)) return 'failed';
  if (status === 'expired') return 'expired';
  if (['created', 'creating', 'pending', 'payment_pending'].includes(status) || !status) return 'pending';
  return '';
}

function badge(order) {
  const status = String(order.status || '').toLowerCase();
  const fulfillment = String(order.fulfillment_status || 'ordered').toLowerCase();
  if (status === 'refunded') return ['Refunded', 'good'];
  if (status === 'refund_failed') return ['Refund needs attention', 'warn'];
  if (['refund_pending', 'refund_initiated'].includes(status)) return ['Refund in progress', 'warn'];
  if (['cancelled', 'cod_cancelled'].includes(status) || fulfillment === 'cancelled') return ['Cancelled', 'warn'];
  const paymentState = prepaidPaymentState(order);
  if (paymentState === 'failed') return ['Payment failed', 'warn'];
  if (paymentState === 'expired') return ['Payment expired', 'warn'];
  if (paymentState === 'pending') return ['Payment pending', 'warn'];
  if (status === 'paid') return ['Payment confirmed', 'good'];
  if (status === 'cod_pending') return ['Cash on Delivery', 'warn'];
  return ['Order confirmed', ''];
}

function hero(order) {
  const heading = document.querySelector('.success h1');
  const paragraph = document.querySelector('.success p');
  const status = String(order.status || '').toLowerCase();
  const fulfillment = String(order.fulfillment_status || '').toLowerCase();
  const paymentState = prepaidPaymentState(order);
  if (!heading || !paragraph) return;
  if (status === 'refunded') {
    heading.textContent = 'Order refunded';
    paragraph.textContent = 'This order is closed and the refund has been processed. Review Order Details for the latest refund information.';
    return;
  }
  if (status === 'refund_failed') {
    heading.textContent = 'Refund needs attention';
    paragraph.textContent = 'This order is closed, but the refund could not be completed. Review Order Details for the latest status.';
    return;
  }
  if (['refund_pending', 'refund_initiated'].includes(status)) {
    heading.textContent = 'Refund in progress';
    paragraph.textContent = 'This order is closed and the refund is being processed. Review Order Details for the latest status.';
    return;
  }
  if (['cancelled', 'cod_cancelled'].includes(status) || fulfillment === 'cancelled') {
    heading.textContent = 'Order cancelled';
    paragraph.textContent = 'This order is closed. Review Order Details for the latest payment or refund state.';
    return;
  }
  if (paymentState === 'pending') {
    heading.textContent = 'Payment pending';
    paragraph.textContent = 'Your payment has not been confirmed yet. Fulfilment starts only after payment is confirmed.';
    return;
  }
  if (paymentState === 'failed') {
    heading.textContent = 'Payment not completed';
    paragraph.textContent = 'This order has not entered fulfilment because the payment was not completed.';
    return;
  }
  if (paymentState === 'expired') {
    heading.textContent = 'Payment session expired';
    paragraph.textContent = 'This checkout attempt expired before payment was confirmed. Start a new checkout if you still want these items.';
    return;
  }
  heading.textContent = 'Order placed successfully';
  paragraph.textContent = 'Your order is confirmed. You can review its current payment and fulfilment state below.';
}

function paymentMethodLabel(order) {
  if (order.payment_method === 'cod') return 'Cash on Delivery';
  const state = prepaidPaymentState(order);
  if (state === 'pending') return 'Online payment · Payment pending';
  if (state === 'failed') return 'Online payment · Payment failed';
  if (state === 'expired') return 'Online payment · Payment expired';
  return 'Online payment · Paid';
}

function render(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const stateBadge = badge(order);
  const display = order.display_order_id || order.id;
  const subtotal = items.reduce((sum, item) => sum + Number(item.taxable_amount || Number(item.unit_price || 0) * Number(item.qty || item.quantity || 1)), 0);
  const gst = items.reduce((sum, item) => sum + Number(item.gst_amount || 0), 0);
  const coupon = Number(order.coupon_discount || 0);
  const gift = Number(order.gift_card_discount || 0);
  const delivery = Math.max(0, Number(order.total_amount) - subtotal - gst + coupon + gift);
  hero(order);
  document.getElementById('orderRef').innerHTML = 'Order <strong>#' + esc(display) + '</strong> &nbsp; <span class="badge ' + stateBadge[1] + '">' + esc(stateBadge[0]) + '</span>';
  document.getElementById('items').innerHTML = items.length
    ? items.map(item => '<div class="item"><div><div class="name">' + esc(item.name || 'Product') + '</div><div class="meta">Qty ' + esc(item.qty || item.quantity || 1) + (item.category ? ' · ' + esc(item.category) : '') + (item.gst_rate != null ? ' · GST ' + esc(item.gst_rate) + '%' : '') + '</div></div><div class="amount">' + money(item.line_total || Number(item.unit_price || 0) * Number(item.qty || item.quantity || 1)) + '</div></div>').join('')
    : '<div class="meta">Order item details unavailable.</div>';
  document.getElementById('address').innerHTML = addressMarkup(order);
  document.getElementById('payment').innerHTML =
    '<div class="row"><span>Payment method</span><span>' + esc(paymentMethodLabel(order)) + '</span></div>' +
    '<div class="row"><span>Product subtotal</span><span>' + money(subtotal) + '</span></div>' +
    '<div class="row"><span>GST</span><span>' + money(gst) + '</span></div>' +
    '<div class="row"><span>Delivery</span><span>' + (delivery ? money(delivery) : '<span class="saving">FREE</span>') + '</span></div>' +
    (coupon > 0 ? '<div class="row saving"><span>Coupon discount</span><span>− ' + money(coupon) + '</span></div>' : '') +
    (gift > 0 ? '<div class="row saving"><span>Gift card</span><span>− ' + money(gift) + '</span></div>' : '') +
    '<div class="row total"><span>Total</span><span>' + money(order.total_amount) + '</span></div>';
  document.getElementById('detailsLink').href = 'order-details.html?id=' + encodeURIComponent(order.id);
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = false;
}

async function resolvedUser() {
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  if (user) return user;
  if (error) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session?.user) return session.user;
    } catch {}
  }
  return null;
}

async function init() {
  const id = new URLSearchParams(location.search).get('id');
  if (!/^\d+$/.test(String(id || ''))) throw new Error('Order reference is missing.');
  const user = await resolvedUser();
  if (!user) {
    const target = 'order-confirmation.html' + location.search + location.hash;
    location.href = 'login.html?redirect=' + encodeURIComponent(target);
    return;
  }
  const { data, error } = await supabaseClient
    .from('orders')
    .select('id,display_order_id,user_id,total_amount,status,payment_method,payment_verified_at,fulfillment_status,customer_name,items,shipping_address,created_at,coupon_discount,gift_card_discount')
    .eq('id', Number(id))
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Order could not be found.');
  render(data);
}

init().catch(error => {
  console.error(error);
  document.getElementById('loading').textContent = error.message || 'Confirmation could not be loaded.';
});

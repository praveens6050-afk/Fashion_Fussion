const {
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  getSupabaseUser,
  calculate,
  paymentPricing
} = require('../lib');
const { getDiscounts } = require('./quote-order');
const {
  isPayUConfigured,
  txnidForOrder,
  buildHostedCheckout
} = require('../payu');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Store database request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function rpc(name, args) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { ...serverHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Checkout operation failed');
  return data;
}

function validateCheckoutKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw new Error('Checkout session is invalid. Please refresh checkout and try again.');
  }
  return key;
}

function cleanAddress(address) {
  if (!address) throw new Error('Please add a delivery address before checkout.');
  const fullName = String(address.full_name || '').trim();
  const phone = String(address.phone || '').trim();
  const line1 = String(address.address_line1 || '').trim();
  const city = String(address.city || '').trim();
  const state = String(address.state || '').trim();
  const postal = String(address.postal_code || '').trim();
  const country = String(address.country || 'India').trim();
  if (!fullName || !phone || !line1 || !city || !state || !postal || !country) {
    throw new Error('Please complete your delivery address before checkout.');
  }
  if (!/^\+?[0-9 -]{10,20}$/.test(phone)) throw new Error('Please use a valid delivery phone number.');
  if (!/^\d{6}$/.test(postal)) throw new Error('Please use a valid 6-digit delivery PIN code.');
  return {
    id: address.id || null,
    label: String(address.label || 'Home').trim(),
    full_name: fullName,
    phone,
    address_line1: line1,
    address_line2: address.address_line2 ? String(address.address_line2).trim() : null,
    city,
    state,
    postal_code: postal,
    country
  };
}

async function getAddress(userId, requestedId) {
  const filter = requestedId && /^\d+$/.test(String(requestedId))
    ? 'id=eq.' + encodeURIComponent(requestedId)
    : 'is_default=eq.true';
  const rows = await rest(
    'customer_addresses?user_id=eq.' + encodeURIComponent(userId) + '&' + filter +
    '&select=id,label,full_name,phone,address_line1,address_line2,city,state,postal_code,country&limit=1'
  );
  return rows?.[0] || null;
}

async function getBusinessProfile(userId) {
  const rows = await rest(
    'business_profiles?user_id=eq.' + encodeURIComponent(userId) +
    '&select=user_id,business_name,gstin,billing_address&limit=1'
  );
  return rows?.[0] || null;
}

function businessSnapshot(profile, purchaseOrderNo) {
  if (!profile?.business_name || !String(profile.business_name).trim()) {
    throw new Error('Save your business details before requesting a GST/business invoice.');
  }
  const gstin = profile.gstin ? String(profile.gstin).trim().toUpperCase() : null;
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    throw new Error('Your saved GSTIN format is invalid. Please update Business & Bulk in My Account.');
  }
  const po = String(purchaseOrderNo || '').trim();
  if (po.length > 100) throw new Error('Purchase order number is too long.');
  return {
    is_business_order: true,
    business_name: String(profile.business_name).trim(),
    business_gstin: gstin,
    business_billing_address: profile.billing_address || null,
    purchase_order_no: po || null
  };
}

async function enforceRateLimit(userId) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const response = await fetch(
    SUPABASE_URL + '/rest/v1/orders?user_id=eq.' + encodeURIComponent(userId) +
    '&created_at=gte.' + encodeURIComponent(since) +
    '&status=in.(creating,created,cod_pending)&select=id',
    { method: 'HEAD', headers: { ...serverHeaders, Prefer: 'count=exact' } }
  );
  if (!response.ok) throw new Error('Could not validate checkout rate limit');
  const count = Number((response.headers.get('content-range') || '0/0').split('/')[1] || 0);
  if (count >= 5) throw new Error('Too many checkout attempts. Please wait a few minutes before trying again.');
}

async function reserveCheckout(orderId, userId) {
  try {
    await rpc('reserve_order_promotions', { p_order_id: orderId, p_user_id: userId });
    await rpc('reserve_order_inventory', { p_order_id: orderId });
  } catch (error) {
    await rpc('release_order_inventory', { p_order_id: orderId }).catch(() => null);
    await rpc('release_order_promotions', { p_order_id: orderId, p_user_id: userId }).catch(() => null);
    throw error;
  }
}

async function findExisting(userId, checkoutKey) {
  const rows = await rest(
    'orders?user_id=eq.' + encodeURIComponent(userId) +
    '&checkout_key=eq.' + encodeURIComponent(checkoutKey) +
    '&select=id,user_id,display_order_id,total_amount,currency,status,payment_method,payment_provider,payu_txnid,payu_mihpayid,customer_name,customer_email,customer_phone,shipping_address&limit=1'
  );
  return rows?.[0] || null;
}

function inactive(status) {
  return ['payment_failed', 'expired', 'cancelled', 'cod_cancelled', 'refund_initiated', 'refund_pending', 'refund_failed', 'refunded']
    .includes(String(status || '').toLowerCase());
}

async function prepareExisting(order, userId) {
  if (order.payment_method !== 'prepaid') {
    const error = new Error('Payment method changed. Please start a new checkout attempt.');
    error.retryWithNewCheckout = true;
    throw error;
  }
  if (order.status === 'paid' || order.payu_mihpayid) {
    return {
      completed: true,
      status: 'paid',
      store_order_id: order.id,
      display_order_id: order.display_order_id,
      payment_method: 'prepaid',
      payment_provider: 'payu'
    };
  }
  if (inactive(order.status)) {
    const error = new Error('This checkout attempt is no longer active. Please try again.');
    error.retryWithNewCheckout = true;
    throw error;
  }
  if (order.payment_provider && order.payment_provider !== 'payu') {
    const error = new Error('This checkout was created with a different payment provider. Please start a new checkout attempt.');
    error.retryWithNewCheckout = true;
    throw error;
  }
  if (!['creating', 'created'].includes(String(order.status || '').toLowerCase())) {
    throw new Error('This checkout attempt cannot be resumed.');
  }

  if (!order.payu_txnid) {
    await reserveCheckout(order.id, userId);
    order.payu_txnid = txnidForOrder(order.id);
    await rest(
      'orders?id=eq.' + encodeURIComponent(order.id) + '&user_id=eq.' + encodeURIComponent(userId),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_provider: 'payu', payu_txnid: order.payu_txnid, status: 'created' })
      }
    );
    order.payment_provider = 'payu';
    order.status = 'created';
  }

  return {
    completed: false,
    status: order.status,
    store_order_id: order.id,
    display_order_id: order.display_order_id,
    payment_method: 'prepaid',
    payment_provider: 'payu',
    total: Number(order.total_amount),
    gateway: buildHostedCheckout(order)
  };
}

module.exports = async function createPayUOrder(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });
  if (!isPayUConfigured()) {
    return json(req, res, 503, { error: 'PayU server credentials are not configured' });
  }

  try {
    const user = await getSupabaseUser(req);
    const body = await readBody(req);
    if (String(body.payment_method || 'prepaid').toLowerCase() !== 'prepaid') {
      return json(req, res, 400, { error: 'PayU is only available for prepaid orders' });
    }
    const checkoutKey = validateCheckoutKey(body.checkout_key);
    const existing = await findExisting(user.id, checkoutKey);
    if (existing) {
      try {
        return json(req, res, 200, await prepareExisting(existing, user.id));
      } catch (error) {
        return json(req, res, error.retryWithNewCheckout ? 409 : 400, {
          error: error.message || 'Checkout could not be resumed',
          retry_with_new_checkout: Boolean(error.retryWithNewCheckout)
        });
      }
    }

    await enforceRateLimit(user.id);
    const calc = await calculate(body.items);
    const promo = await getDiscounts(body, calc);
    const payment = paymentPricing(promo.payable, 'prepaid');
    const customerName = String(body.customer_name || '').trim();
    if (!customerName) throw new Error('Customer name is required');
    if (!user.email) throw new Error('A verified email address is required for online payment');

    const address = cleanAddress(await getAddress(user.id, body.shipping_address?.id));
    const customerPhone = String(body.customer_phone || address.phone || '').trim();
    if (!customerPhone) throw new Error('Customer mobile number is required');

    let business = {
      is_business_order: false,
      business_name: null,
      business_gstin: null,
      business_billing_address: null,
      purchase_order_no: null
    };
    if (body.business_invoice === true) {
      business = businessSnapshot(await getBusinessProfile(user.id), body.purchase_order_no);
    }

    const orderInsert = {
      user_id: user.id,
      razorpay_order_id: null,
      payment_provider: payment.total > 0 ? 'payu' : null,
      payu_txnid: null,
      total_amount: payment.total,
      currency: 'INR',
      status: 'creating',
      payment_method: 'prepaid',
      payment_handling_fee: payment.payment_handling_fee,
      prepaid_discount: payment.prepaid_discount,
      cod_fee_non_refundable: payment.cod_fee_non_refundable,
      checkout_key: checkoutKey,
      customer_name: customerName,
      customer_email: user.email,
      customer_phone: customerPhone,
      items: calc.items,
      coupon_code: promo.coupon?.code || null,
      coupon_discount: promo.couponDiscount,
      gift_card_code: promo.gift?.code || null,
      gift_card_discount: promo.giftDiscount,
      shipping_address: address,
      ...business
    };

    let saved;
    try {
      const rows = await rest('orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(orderInsert)
      });
      saved = rows?.[0];
    } catch (error) {
      const raced = await findExisting(user.id, checkoutKey).catch(() => null);
      if (raced) return json(req, res, 200, await prepareExisting(raced, user.id));
      throw error;
    }
    if (!saved?.id) throw new Error('The store could not create your order. Please try again.');

    try {
      await reserveCheckout(saved.id, user.id);
    } catch (error) {
      await rest('orders?id=eq.' + encodeURIComponent(saved.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'payment_failed' })
      }).catch(() => null);
      throw error;
    }

    if (payment.total === 0) {
      await rpc('finalize_zero_value_order_inventory', {
        p_order_id: saved.id,
        p_user_id: user.id,
        p_source: 'gift_card'
      });
      return json(req, res, 200, {
        completed: true,
        zero_value: true,
        status: 'paid',
        store_order_id: saved.id,
        display_order_id: saved.display_order_id,
        payment_method: 'prepaid',
        total: 0
      });
    }

    saved.payu_txnid = txnidForOrder(saved.id);
    saved.payment_provider = 'payu';
    saved.status = 'created';
    await rest(
      'orders?id=eq.' + encodeURIComponent(saved.id) + '&user_id=eq.' + encodeURIComponent(user.id),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_provider: 'payu',
          payu_txnid: saved.payu_txnid,
          status: 'created'
        })
      }
    );

    return json(req, res, 200, {
      completed: false,
      status: 'created',
      store_order_id: saved.id,
      display_order_id: saved.display_order_id,
      payment_method: 'prepaid',
      payment_provider: 'payu',
      items: calc.items,
      coupon_code: promo.coupon?.code || null,
      gift_card_code: promo.gift?.code || null,
      total: payment.total,
      gateway: buildHostedCheckout(saved)
    });
  } catch (error) {
    console.error('create-payu-order error:', error);
    return json(req, res, error.status || 400, { error: error.message || 'Unable to create PayU order' });
  }
};

const {
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  getSupabaseUser,
  calculate,
  roundMoney,
  paymentPricing
} = require('../lib');

async function one(path) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: serverHeaders });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || 'Offer lookup failed');
  return data?.[0] || null;
}

async function redemptionCount(couponId) {
  const response = await fetch(
    SUPABASE_URL + '/rest/v1/coupon_redemptions?coupon_id=eq.' + encodeURIComponent(couponId) + '&select=id',
    { method: 'HEAD', headers: { ...serverHeaders, Prefer: 'count=exact' } }
  );
  if (!response.ok) throw new Error('Could not validate coupon usage');
  const range = response.headers.get('content-range') || '0/0';
  return Number(range.split('/')[1] || 0);
}

async function discounts(body, calc) {
  let couponDiscount = 0;
  let giftDiscount = 0;
  let coupon = null;
  let gift = null;

  const couponCode = String(body?.coupon_code || '').trim().toUpperCase();
  const giftCode = String(body?.gift_card_code || '').trim().toUpperCase();

  if (couponCode) {
    coupon = await one(
      'coupons?code=eq.' + encodeURIComponent(couponCode) + '&is_active=eq.true&select=*'
    );
    if (!coupon) throw new Error('Coupon is invalid or inactive');

    const now = Date.now();
    if (
      new Date(coupon.starts_at).getTime() > now ||
      (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now)
    ) {
      throw new Error('Coupon is not currently valid');
    }

    if (calc.subtotal < Number(coupon.min_order_amount || 0)) {
      throw new Error('Minimum order for this coupon is ₹' + Number(coupon.min_order_amount || 0));
    }

    if (coupon.usage_limit) {
      const count = await redemptionCount(coupon.id);
      if (count >= Number(coupon.usage_limit)) throw new Error('Coupon usage limit reached');
    }

    couponDiscount = coupon.discount_type === 'percent'
      ? calc.subtotal * Number(coupon.discount_value) / 100
      : Number(coupon.discount_value);

    if (coupon.max_discount != null) {
      couponDiscount = Math.min(couponDiscount, Number(coupon.max_discount));
    }
    couponDiscount = Math.min(couponDiscount, calc.subtotal);
  }

  const afterCoupon = Math.max(0, calc.total - couponDiscount);

  if (giftCode) {
    gift = await one(
      'gift_card_codes?code=eq.' + encodeURIComponent(giftCode) + '&is_active=eq.true&select=*'
    );
    if (!gift || Number(gift.balance) <= 0) {
      throw new Error('Gift card is invalid or has no balance');
    }
    if (gift.expires_at && new Date(gift.expires_at).getTime() <= Date.now()) {
      throw new Error('Gift card has expired');
    }
    giftDiscount = Math.min(Number(gift.balance), afterCoupon);
  }

  return {
    coupon,
    couponDiscount: roundMoney(couponDiscount),
    gift,
    giftDiscount: roundMoney(giftDiscount),
    payable: roundMoney(Math.max(0, afterCoupon - giftDiscount))
  };
}

module.exports = async function quoteOrder(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Method not allowed' });

  try {
    await getSupabaseUser(req);
    const body = await readBody(req);
    const calc = await calculate(body.items);
    const promo = await discounts(body, calc);
    const payment = paymentPricing(promo.payable, body.payment_method);

    return json(req, res, 200, {
      pricing: {
        ...calc,
        coupon_discount: promo.couponDiscount,
        gift_card_discount: promo.giftDiscount,
        payment_handling_fee: payment.payment_handling_fee,
        prepaid_discount: payment.prepaid_discount,
        cod_fee: payment.cod_fee,
        cod_fee_non_refundable: payment.cod_fee_non_refundable,
        payment_method: payment.payment_method,
        total: payment.total
      },
      coupon_code: promo.coupon?.code || null,
      gift_card_code: promo.gift?.code || null
    });
  } catch (error) {
    return json(req, res, 400, { error: error.message || 'Unable to calculate offer' });
  }
};

module.exports.getDiscounts = discounts;

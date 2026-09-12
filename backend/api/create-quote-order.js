const {
  KEY_ID,
  KEY_SECRET,
  SUPABASE_URL,
  serverHeaders,
  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser,
  normalizePaymentMethod,
  paymentPricing,
  roundMoney
} = require('../lib');

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...serverHeaders, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Store database request failed');
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

async function getAddress(userId, requestedId) {
  const filter = requestedId && /^\d+$/.test(String(requestedId)) ? 'id=eq.' + encodeURIComponent(requestedId) : 'is_default=eq.true';
  const data = await rest('customer_addresses?user_id=eq.' + encodeURIComponent(userId) + '&' + filter + '&select=id,label,full_name,phone,address_line1,address_line2,city,state,postal_code,country&limit=1');
  return data?.[0] || null;
}

function cleanAddress(address) {
  if (!address) throw new Error('Please add a delivery address before checkout.');
  const required = [address.full_name,address.phone,address.address_line1,address.city,address.state,address.postal_code,address.country];
  if (required.some(value => !String(value || '').trim())) throw new Error('Please complete your delivery address before checkout.');
  if (!/^\d{6}$/.test(String(address.postal_code).trim())) throw new Error('Please use a valid 6-digit delivery PIN code.');
  return {id:address.id||null,label:String(address.label||'Home').trim(),full_name:String(address.full_name).trim(),phone:String(address.phone).trim(),address_line1:String(address.address_line1).trim(),address_line2:address.address_line2?String(address.address_line2).trim():null,city:String(address.city).trim(),state:String(address.state).trim(),postal_code:String(address.postal_code).trim(),country:String(address.country||'India').trim()};
}

async function loadQuote(userId, quoteId) {
  const rows = await rest(
    'bulk_quotes?id=eq.' + encodeURIComponent(quoteId) +
    '&user_id=eq.' + encodeURIComponent(userId) +
    '&select=id,user_id,business_name,gstin,status,quoted_subtotal,quoted_gst,quoted_delivery,quoted_total,valid_until,accepted_at&limit=1'
  );
  return rows?.[0] || null;
}

async function loadQuoteItems(quoteId) {
  const rows = await rest(
    'bulk_quote_items?quote_id=eq.' + encodeURIComponent(quoteId) +
    '&select=id,product_id,quantity,quoted_unit_price,products(id,name,category,image_url,gst_rate,price,is_active)'
  );
  return rows || [];
}

async function findExistingQuoteOrder(userId, quoteId) {
  const rows = await rest(
    'orders?user_id=eq.' + encodeURIComponent(userId) +
    '&bulk_quote_id=eq.' + encodeURIComponent(quoteId) +
    '&select=id,display_order_id,razorpay_order_id,total_amount,currency,status,payment_method&limit=1'
  );
  return rows?.[0] || null;
}

async function createRazorpayOrder(storeOrder, userId, quoteId) {
  if (!KEY_ID || !KEY_SECRET) throw new Error('Razorpay server keys are not configured');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(Number(storeOrder.total_amount) * 100),
      currency: storeOrder.currency || 'INR',
      receipt: 'FFQ_' + storeOrder.id,
      notes: { store:'Fashion_Fussion', user_id:userId, store_order_id:String(storeOrder.id), bulk_quote_id:String(quoteId) },
      partial_payment: false
    })
  });
  const order = await response.json().catch(() => ({}));
  if (!response.ok || !order?.id) throw new Error(order?.error?.description || 'Razorpay order creation failed');
  return order;
}

function normalizeQuoteItems(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Quote has no items.');
  let subtotal = 0;
  let gst = 0;
  const items = rows.map(row => {
    const product = row.products;
    const qty = Number(row.quantity);
    const unitPrice = Number(row.quoted_unit_price);
    const gstRate = Number(product?.gst_rate);
    if (!product || product.is_active !== true) throw new Error('A quoted product is no longer available.');
    if (!Number.isInteger(qty) || qty < 2 || qty > 500) throw new Error('Quoted quantity is invalid.');
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Quoted unit price is invalid.');
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error('Quoted product GST rate is invalid.');
    const taxable = roundMoney(unitPrice * qty);
    const gstAmount = roundMoney(taxable * gstRate / 100);
    subtotal += taxable;
    gst += gstAmount;
    return {
      id: product.id,
      qty,
      name: product.name,
      category: product.category,
      image_url: product.image_url,
      mrp: Number(product.price),
      discount: roundMoney(Math.max(0, Number(product.price) - unitPrice)),
      unit_price: unitPrice,
      gst_rate: gstRate,
      gst_amount: gstAmount,
      taxable_amount: taxable,
      line_total: roundMoney(taxable + gstAmount),
      bulk_pricing_applied: true,
      bulk_quote_pricing: true
    };
  });
  return { items, subtotal: roundMoney(subtotal), gst: roundMoney(gst) };
}

function existingResponse(order) {
  return {
    idempotent: true,
    store_order_id: order.id,
    display_order_id: order.display_order_id,
    payment_method: order.payment_method,
    status: order.status,
    total: Number(order.total_amount),
    completed: ['paid','cod_pending','cod_collected'].includes(order.status),
    order: order.razorpay_order_id ? { id:order.razorpay_order_id, amount:Math.round(Number(order.total_amount)*100), currency:order.currency||'INR' } : null,
    key_id: order.razorpay_order_id ? KEY_ID : null
  };
}

async function resumeExisting(order, userId, quoteId) {
  if (['paid','cod_pending','cod_collected'].includes(order.status)) return existingResponse(order);
  if (['payment_failed','expired','cancelled','cod_cancelled','refunded'].includes(order.status)) {
    throw new Error('This quote checkout attempt is no longer active. Please contact support before retrying.');
  }
  if (order.status === 'created' && order.razorpay_order_id) return existingResponse(order);
  if (!['creating','created'].includes(order.status)) throw new Error('This quote checkout cannot be resumed.');
  if (order.payment_method === 'cod') {
    await rpc('finalize_checkout_order',{p_order_id:order.id,p_user_id:userId,p_payment_id:null,p_payment_signature:null,p_target_status:'cod_pending',p_source:'quote_cod_resume'});
    return {...existingResponse({...order,status:'cod_pending'}),completed:true};
  }
  const razorpayOrder = await createRazorpayOrder(order,userId,quoteId);
  await rest('orders?id=eq.'+encodeURIComponent(order.id)+'&user_id=eq.'+encodeURIComponent(userId)+'&status=in.(creating,created)',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({razorpay_order_id:razorpayOrder.id,status:'created'})});
  return {...existingResponse({...order,razorpay_order_id:razorpayOrder.id,status:'created'}),key_id:KEY_ID,order:{id:razorpayOrder.id,amount:razorpayOrder.amount,currency:razorpayOrder.currency}};
}

module.exports = async function createQuoteOrder(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    const user=await getSupabaseUser(req);
    const body=await readBody(req);
    const quoteId=Number(body.quote_id);
    if(!Number.isInteger(quoteId)||quoteId<1)throw new Error('Invalid business quote.');
    const paymentMethod=normalizePaymentMethod(body.payment_method);
    const existing=await findExistingQuoteOrder(user.id,quoteId);
    if(existing){
      if(existing.payment_method!==paymentMethod)return json(req,res,409,{error:'Payment method changed for this accepted quote.'});
      return json(req,res,200,await resumeExisting(existing,user.id,quoteId));
    }

    const quote=await loadQuote(user.id,quoteId);
    if(!quote)throw new Error('Business quote was not found.');
    if(quote.status!=='accepted')throw new Error('Only an accepted business quote can be purchased.');
    if(!quote.accepted_at)throw new Error('Quote acceptance is incomplete.');
    if(quote.valid_until&&new Date(quote.valid_until).getTime()<Date.now())throw new Error('This business quote has expired.');
    const quotedTotal=Number(quote.quoted_total),quotedSubtotal=Number(quote.quoted_subtotal),quotedGst=Number(quote.quoted_gst),quotedDelivery=Number(quote.quoted_delivery);
    if(![quotedTotal,quotedSubtotal,quotedGst,quotedDelivery].every(Number.isFinite)||quotedTotal<=0||quotedSubtotal<0||quotedGst<0||quotedDelivery<0)throw new Error('Quote pricing snapshot is invalid.');

    const normalized=normalizeQuoteItems(await loadQuoteItems(quoteId));
    if(Math.abs(normalized.subtotal-quotedSubtotal)>0.01||Math.abs(normalized.gst-quotedGst)>0.01||Math.abs(roundMoney(normalized.subtotal+normalized.gst+quotedDelivery)-quotedTotal)>0.01){
      throw new Error('Quote pricing has changed. Please ask the business team to reissue the quote.');
    }

    const payment=paymentPricing(quotedTotal,paymentMethod);
    if(paymentMethod==='prepaid'&&payment.total>0&&(!KEY_ID||!KEY_SECRET))return json(req,res,500,{error:'Razorpay server keys are not configured'});
    const address=cleanAddress(await getAddress(user.id,body.shipping_address?.id));
    const customerName=String(body.customer_name||address.full_name||'').trim();
    const customerPhone=String(body.customer_phone||address.phone||'').trim();
    if(!customerName)throw new Error('Customer name is required.');
    if(!customerPhone)throw new Error('Customer mobile number is required.');
    const po=String(body.purchase_order_no||'').trim();
    if(po.length>100)throw new Error('Purchase order number is too long.');

    const orderInsert={
      user_id:user.id,
      bulk_quote_id:quoteId,
      razorpay_order_id:null,
      total_amount:payment.total,
      currency:'INR',
      status:'creating',
      payment_method:paymentMethod,
      payment_handling_fee:0,
      prepaid_discount:0,
      cod_fee_non_refundable:false,
      customer_name:customerName,
      customer_email:user.email||null,
      customer_phone:customerPhone,
      items:normalized.items,
      coupon_code:null,
      coupon_discount:0,
      gift_card_code:null,
      gift_card_discount:0,
      shipping_address:address,
      is_business_order:true,
      business_name:String(quote.business_name||'').trim(),
      business_gstin:quote.gstin?String(quote.gstin).trim().toUpperCase():null,
      business_billing_address:null,
      purchase_order_no:po||null
    };

    let saved;
    try{
      const rows=await rest('orders',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(orderInsert)});
      saved=rows?.[0];
    }catch(error){
      const raced=await findExistingQuoteOrder(user.id,quoteId).catch(()=>null);
      if(raced)return json(req,res,200,await resumeExisting(raced,user.id,quoteId));
      throw error;
    }
    if(!saved?.id)throw new Error('The store could not create your quote order.');

    if(paymentMethod==='cod'){
      await rpc('finalize_checkout_order',{p_order_id:saved.id,p_user_id:user.id,p_payment_id:null,p_payment_signature:null,p_target_status:'cod_pending',p_source:'quote_cod'});
      return json(req,res,200,{store_order_id:saved.id,display_order_id:saved.display_order_id,payment_method:'cod',status:'cod_pending',completed:true,bulk_quote_id:quoteId,items:normalized.items,pricing:{subtotal:quotedSubtotal,gst:quotedGst,delivery:quotedDelivery,total:payment.total},total:payment.total});
    }

    const razorpayOrder=await createRazorpayOrder(saved,user.id,quoteId);
    await rest('orders?id=eq.'+encodeURIComponent(saved.id)+'&user_id=eq.'+encodeURIComponent(user.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({razorpay_order_id:razorpayOrder.id,status:'created'})});
    return json(req,res,200,{key_id:KEY_ID,store_order_id:saved.id,display_order_id:saved.display_order_id,payment_method:'prepaid',status:'created',bulk_quote_id:quoteId,order:{id:razorpayOrder.id,amount:razorpayOrder.amount,currency:razorpayOrder.currency},items:normalized.items,pricing:{subtotal:quotedSubtotal,gst:quotedGst,delivery:quotedDelivery,total:payment.total},total:payment.total});
  }catch(error){
    console.error('create-quote-order error:',error);
    return json(req,res,400,{error:error.message||'Unable to create quote order'});
  }
};

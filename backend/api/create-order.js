const {
  KEY_ID, KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  cors, json, readBody, basicAuth, getSupabaseUser, calculate
} = require("../lib");
const { getDiscounts } = require("./quote-order");
const serverHeaders={apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+SUPABASE_SERVICE_ROLE_KEY};

async function getDefaultAddress(userId) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/customer_addresses?user_id=eq." + encodeURIComponent(userId) + "&is_default=eq.true&select=id,label,full_name,phone,address_line1,address_line2,city,state,postal_code,country&limit=1", { headers: serverHeaders });
  const data = await response.json();
  if (!response.ok) throw new Error("Could not load your delivery address");
  return data?.[0] || null;
}
async function rpc(name,args){const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{...serverHeaders,"Content-Type":"application/json"},body:JSON.stringify(args)});if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d?.message||"Promotion reservation failed")}return r}

module.exports = async function (req, res) {
  cors(res); if(req.method==="OPTIONS"){res.statusCode=204;return res.end()} if(req.method!=="POST")return json(res,405,{error:"Method not allowed"});
  if(!KEY_ID||!KEY_SECRET)return json(res,500,{error:"Razorpay server keys are not configured"});
  try {
    const user=await getSupabaseUser(req),body=await readBody(req),calc=await calculate(body.items),promo=await getDiscounts(body,calc);
    if(promo.payable<1) throw new Error("Gift card covers the full order. Zero-value orders are not supported yet.");
    const customerName=String(body.customer_name||"").trim(); if(!customerName)throw new Error("Customer name is required");
    const address=body.shipping_address&&typeof body.shipping_address==="object"?body.shipping_address:await getDefaultAddress(user.id); if(!address)throw new Error("Please add a delivery address before checkout.");
    const customerPhone=String(body.customer_phone||address.phone||"").trim(); if(!customerPhone)throw new Error("Customer mobile number is required");
    const required=[address.full_name,address.phone,address.address_line1,address.city,address.state,address.postal_code,address.country]; if(required.some(v=>!String(v||"").trim()))throw new Error("Please complete your delivery address before checkout.");
    const receipt="FF_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);
    const rr=await fetch("https://api.razorpay.com/v1/orders",{method:"POST",headers:{Authorization:basicAuth(),"Content-Type":"application/json"},body:JSON.stringify({amount:Math.round(promo.payable*100),currency:"INR",receipt,notes:{store:"Fashion_Fussion",user_id:user.id},partial_payment:false})});
    const razorpayOrder=await rr.json(); if(!rr.ok)return json(res,502,{error:razorpayOrder?.error?.description||"Razorpay order creation failed"});
    const sr=await fetch(SUPABASE_URL+"/rest/v1/orders",{method:"POST",headers:{...serverHeaders,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({user_id:user.id,razorpay_order_id:razorpayOrder.id,total_amount:promo.payable,currency:"INR",status:"created",customer_name:customerName,customer_email:user.email||null,customer_phone:customerPhone,items:calc.items,coupon_code:promo.coupon?.code||null,coupon_discount:promo.couponDiscount,gift_card_code:promo.gift?.code||null,gift_card_discount:promo.giftDiscount,shipping_address:{id:address.id||null,label:String(address.label||"Home").trim(),full_name:String(address.full_name).trim(),phone:String(address.phone).trim(),address_line1:String(address.address_line1).trim(),address_line2:address.address_line2?String(address.address_line2).trim():null,city:String(address.city).trim(),state:String(address.state).trim(),postal_code:String(address.postal_code).trim(),country:String(address.country).trim()}})});
    const saved=await sr.json(); if(!sr.ok||!saved?.[0]?.id){console.error("Supabase order insert failed:",saved);return json(res,500,{error:"Payment order was created, but the store could not save the order. Please contact support before retrying."})}
    try{await rpc("reserve_order_promotions",{p_order_id:saved[0].id,p_user_id:user.id})}catch(e){console.error("Promotion reservation failed:",e);return json(res,409,{error:e.message||"Offer could not be reserved. Please retry."})}
    return json(res,200,{key_id:KEY_ID,store_order_id:saved[0].id,order:{id:razorpayOrder.id,amount:razorpayOrder.amount,currency:razorpayOrder.currency},items:calc.items,pricing:{...calc,coupon_discount:promo.couponDiscount,gift_card_discount:promo.giftDiscount,total:promo.payable},coupon_code:promo.coupon?.code||null,gift_card_code:promo.gift?.code||null,total:promo.payable});
  } catch(error){console.error("create-order error:",error);return json(res,400,{error:error.message||"Unable to create order"})}
};
const crypto=require("crypto");
const {KEY_SECRET,cors,json,readBody,basicAuth}=require("../lib");

module.exports=async function(req,res){
  cors(res);
  if(req.method==="OPTIONS"){res.statusCode=204;return res.end();}
  if(req.method!=="POST") return json(res,405,{error:"Method not allowed"});
  if(!KEY_SECRET) return json(res,500,{error:"Razorpay server key is not configured"});
  try{
    const b=await readBody(req);
    if(!b.order_id||!b.razorpay_payment_id||!b.razorpay_order_id||!b.razorpay_signature) return json(res,400,{error:"Missing payment fields"});
    if(b.order_id!==b.razorpay_order_id) return json(res,400,{error:"Order ID mismatch"});
    const expected=crypto.createHmac("sha256",KEY_SECRET).update(b.order_id+"|"+b.razorpay_payment_id).digest("hex");
    const a=Buffer.from(expected,"utf8"), c=Buffer.from(b.razorpay_signature,"utf8");
    if(a.length!==c.length||!crypto.timingSafeEqual(a,c)) return json(res,400,{verified:false,error:"Invalid payment signature"});

    const r=await fetch("https://api.razorpay.com/v1/payments/"+encodeURIComponent(b.razorpay_payment_id),{headers:{Authorization:basicAuth()}});
    const payment=await r.json();
    if(!r.ok) return json(res,502,{verified:false,error:"Could not verify payment status"});
    if(payment.order_id!==b.order_id) return json(res,400,{verified:false,error:"Payment/order mismatch"});
    if(payment.status!=="captured") return json(res,400,{verified:false,error:"Payment is not captured yet"});

    // IMPORTANT: For a real store, save the verified order to a database here
    // and trigger fulfilment/email only after verification.
    return json(res,200,{verified:true,payment_id:b.razorpay_payment_id,status:payment.status});
  }catch(e){return json(res,400,{verified:false,error:e.message||"Verification failed"});}
};
